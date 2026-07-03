// 재고 이동 처리기 — InvMovement 생성과 InvStockLevel 동기화를 하나의 DB 트랜잭션으로 묶는다.
// 모든 이동 유형(INBOUND/OUTBOUND/RETURN/TRANSFER/ADJUSTMENT)은 반드시 여기로 통과한다.

import { prisma } from '@/lib/prisma'
import type { InvMovement } from '@/generated/prisma/client'

export type MovementType = 'INBOUND' | 'OUTBOUND' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT'

export type MovementInput = {
  type: MovementType
  productName?: string
  productCode?: string | null
  optionName?: string
  optionSku?: string | null
  optionId?: string
  locationId: string
  toLocationId?: string
  channelId?: string
  quantity: number
  movementDate: string
  orderDate?: string
  reason?: string
  referenceId?: string
  importHistoryId?: string
}

export type MovementResult = {
  movement: InvMovement
  stockLevelAfter: number
  warnings: string[]
}

export class MovementError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

// Prisma 트랜잭션 클라이언트 타입 (첫 번째 인자 타입)
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

// StockLevel 행 잠금 — Prisma 7 에 typed FOR UPDATE 가 없어서 raw SQL 사용
export async function lockStockLevel(tx: Tx, optionId: string, locationId: string): Promise<void> {
  await tx.$queryRaw`SELECT id, quantity FROM "InvStockLevel" WHERE "optionId" = ${optionId} AND "locationId" = ${locationId} FOR UPDATE`
}

async function assertLocationInSpace(
  tx: Tx,
  spaceId: string,
  locationId: string,
  label = '보관 장소'
) {
  const loc = await tx.invStorageLocation.findUnique({ where: { id: locationId } })
  if (!loc || loc.spaceId !== spaceId) {
    throw new MovementError(`${label}을(를) 찾을 수 없습니다`, 404)
  }
  if (!loc.isActive) {
    throw new MovementError(`${label}이(가) 비활성화되었습니다`, 400)
  }
  return loc
}

async function assertOptionInSpace(tx: Tx, spaceId: string, optionId: string) {
  const option = await tx.invProductOption.findUnique({
    where: { id: optionId },
    include: { product: { select: { spaceId: true, status: true } } },
  })
  if (!option || option.product.spaceId !== spaceId) {
    throw new MovementError('상품 옵션을 찾을 수 없습니다', 404)
  }
  if (option.product.status !== 'ACTIVE') {
    throw new MovementError('미사용 상품입니다. 사용 재개 후 처리하세요', 400)
  }
  return option
}

// INBOUND 시 상품/옵션을 자동 생성 또는 조회
async function resolveOrCreateOption(
  tx: Tx,
  spaceId: string,
  input: MovementInput
): Promise<string> {
  if (input.optionId) {
    await assertOptionInSpace(tx, spaceId, input.optionId)
    return input.optionId
  }

  const productName = input.productName?.trim()
  if (!productName) {
    throw new MovementError('productName 또는 optionId가 필요합니다', 400)
  }
  const optionName = input.optionName?.trim() || '기본'

  // productCode 가 있으면 코드 기반 lookup 우선
  let product = null as Awaited<ReturnType<typeof tx.invProduct.findFirst>> | null
  if (input.productCode) {
    product = await tx.invProduct.findFirst({
      where: { spaceId, code: input.productCode, status: 'ACTIVE' },
    })
  }
  if (!product) {
    product = await tx.invProduct.findFirst({
      where: { spaceId, name: productName, status: 'ACTIVE' },
    })
  }
  if (!product) {
    const inactiveProduct = await tx.invProduct.findFirst({
      where: {
        spaceId,
        status: 'INACTIVE',
        OR: [...(input.productCode ? [{ code: input.productCode }] : []), { name: productName }],
      },
      select: { id: true },
    })
    if (inactiveProduct) {
      throw new MovementError('미사용 상품이 존재합니다. 사용 재개 후 처리하세요', 400)
    }

    // groupId 필수 — 기본 카테고리 upsert
    const defaultGroup = await tx.invProductGroup.upsert({
      where: { spaceId_name: { spaceId, name: '기본' } },
      update: {},
      create: { spaceId, name: '기본' },
      select: { id: true },
    })
    product = await tx.invProduct.create({
      data: {
        spaceId,
        name: productName,
        code: input.productCode ?? null,
        groupId: defaultGroup.id,
      },
    })
  }

  let option = await tx.invProductOption.findFirst({
    where: { productId: product.id, name: optionName },
  })
  if (!option) {
    option = await tx.invProductOption.create({
      data: {
        productId: product.id,
        name: optionName,
        sku: input.optionSku ?? null,
      },
    })
  }
  return option.id
}

async function upsertStockLevel(
  tx: Tx,
  spaceId: string,
  optionId: string,
  locationId: string,
  delta: number
): Promise<number> {
  const existing = await tx.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  if (!existing) {
    const created = await tx.invStockLevel.create({
      data: { spaceId, optionId, locationId, quantity: delta },
    })
    return created.quantity
  }
  const updated = await tx.invStockLevel.update({
    where: { id: existing.id },
    data: { quantity: existing.quantity + delta },
  })
  return updated.quantity
}

async function setStockLevel(
  tx: Tx,
  spaceId: string,
  optionId: string,
  locationId: string,
  absoluteQuantity: number
): Promise<{ before: number; after: number }> {
  const existing = await tx.invStockLevel.findUnique({
    where: { optionId_locationId: { optionId, locationId } },
  })
  if (!existing) {
    const created = await tx.invStockLevel.create({
      data: { spaceId, optionId, locationId, quantity: absoluteQuantity },
    })
    return { before: 0, after: created.quantity }
  }
  const updated = await tx.invStockLevel.update({
    where: { id: existing.id },
    data: { quantity: absoluteQuantity },
  })
  return { before: existing.quantity, after: updated.quantity }
}

function parseDate(value: string, field: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new MovementError(`${field}이(가) 유효하지 않습니다`, 400)
  }
  return d
}

export async function processMovement(
  spaceId: string,
  input: MovementInput
): Promise<MovementResult> {
  if (!input.type) throw new MovementError('type이 필요합니다', 400)
  if (!input.locationId) throw new MovementError('locationId가 필요합니다', 400)
  if (!input.movementDate) throw new MovementError('movementDate가 필요합니다', 400)
  if (typeof input.quantity !== 'number' || Number.isNaN(input.quantity)) {
    throw new MovementError('quantity가 유효하지 않습니다', 400)
  }

  const movementDate = parseDate(input.movementDate, 'movementDate')
  const orderDate = input.orderDate ? parseDate(input.orderDate, 'orderDate') : null

  return await prisma.$transaction(async (tx) => {
    const warnings: string[] = []
    await assertLocationInSpace(tx, spaceId, input.locationId)

    switch (input.type) {
      case 'INBOUND': {
        if (input.quantity <= 0) {
          throw new MovementError('INBOUND 수량은 양수여야 합니다', 400)
        }
        const optionId = await resolveOrCreateOption(tx, spaceId, input)
        await lockStockLevel(tx, optionId, input.locationId)
        const after = await upsertStockLevel(
          tx,
          spaceId,
          optionId,
          input.locationId,
          input.quantity
        )
        const movement = await tx.invMovement.create({
          data: {
            spaceId,
            optionId,
            locationId: input.locationId,
            type: 'INBOUND',
            quantity: input.quantity,
            movementDate,
            reason: input.reason?.trim() || null,
            referenceId: input.referenceId ?? null,
            importHistoryId: input.importHistoryId ?? null,
          },
        })
        return { movement, stockLevelAfter: after, warnings }
      }

      case 'OUTBOUND': {
        if (!input.optionId) throw new MovementError('optionId가 필요합니다', 400)
        if (!input.channelId) throw new MovementError('channelId가 필요합니다', 400)
        if (input.quantity <= 0) throw new MovementError('OUTBOUND 수량은 양수여야 합니다', 400)
        await assertOptionInSpace(tx, spaceId, input.optionId)
        // 공용 Channel 테이블 조회 (Phase 3: InvSalesChannel 제거)
        const channel = await tx.channel.findUnique({ where: { id: input.channelId } })
        if (!channel || channel.spaceId !== spaceId) {
          throw new MovementError('판매 채널을 찾을 수 없습니다', 404)
        }
        if (!channel.isActive) {
          throw new MovementError('판매 채널이 비활성화되었습니다', 400)
        }
        await lockStockLevel(tx, input.optionId, input.locationId)
        const existing = await tx.invStockLevel.findUnique({
          where: {
            optionId_locationId: { optionId: input.optionId, locationId: input.locationId },
          },
        })
        const before = existing?.quantity ?? 0
        const after = before - input.quantity
        if (!existing) {
          await tx.invStockLevel.create({
            data: {
              spaceId,
              optionId: input.optionId,
              locationId: input.locationId,
              quantity: after,
            },
          })
        } else {
          await tx.invStockLevel.update({
            where: { id: existing.id },
            data: { quantity: after },
          })
        }
        if (after < 0) {
          warnings.push(`재고가 부족합니다 (현재 재고: ${before}, 출고 요청: ${input.quantity})`)
        }
        const movement = await tx.invMovement.create({
          data: {
            spaceId,
            optionId: input.optionId,
            locationId: input.locationId,
            channelId: input.channelId,
            type: 'OUTBOUND',
            quantity: input.quantity,
            movementDate,
            orderDate,
            reason: input.reason?.trim() || null,
            referenceId: input.referenceId ?? null,
            importHistoryId: input.importHistoryId ?? null,
          },
        })
        return { movement, stockLevelAfter: after, warnings }
      }

      case 'RETURN': {
        if (!input.optionId) throw new MovementError('optionId가 필요합니다', 400)
        if (input.quantity <= 0) throw new MovementError('RETURN 수량은 양수여야 합니다', 400)
        await assertOptionInSpace(tx, spaceId, input.optionId)
        await lockStockLevel(tx, input.optionId, input.locationId)
        const after = await upsertStockLevel(
          tx,
          spaceId,
          input.optionId,
          input.locationId,
          input.quantity
        )
        const movement = await tx.invMovement.create({
          data: {
            spaceId,
            optionId: input.optionId,
            locationId: input.locationId,
            type: 'RETURN',
            quantity: input.quantity,
            movementDate,
            reason: input.reason?.trim() || null,
            referenceId: input.referenceId ?? null,
            importHistoryId: input.importHistoryId ?? null,
          },
        })
        return { movement, stockLevelAfter: after, warnings }
      }

      case 'TRANSFER': {
        if (!input.optionId) throw new MovementError('optionId가 필요합니다', 400)
        if (!input.toLocationId) throw new MovementError('toLocationId가 필요합니다', 400)
        if (input.locationId === input.toLocationId) {
          throw new MovementError('출발지와 도착지가 동일할 수 없습니다', 400)
        }
        if (input.quantity <= 0) throw new MovementError('TRANSFER 수량은 양수여야 합니다', 400)
        await assertOptionInSpace(tx, spaceId, input.optionId)
        await assertLocationInSpace(tx, spaceId, input.toLocationId, '도착 보관 장소')

        // 결정론적 잠금 순서(id 오름차순)로 데드락 최소화
        const [firstLoc, secondLoc] =
          input.locationId < input.toLocationId
            ? [input.locationId, input.toLocationId]
            : [input.toLocationId, input.locationId]
        await lockStockLevel(tx, input.optionId, firstLoc)
        await lockStockLevel(tx, input.optionId, secondLoc)

        const source = await tx.invStockLevel.findUnique({
          where: {
            optionId_locationId: { optionId: input.optionId, locationId: input.locationId },
          },
        })
        const sourceBefore = source?.quantity ?? 0
        const sourceAfter = sourceBefore - input.quantity
        if (!source) {
          await tx.invStockLevel.create({
            data: {
              spaceId,
              optionId: input.optionId,
              locationId: input.locationId,
              quantity: sourceAfter,
            },
          })
        } else {
          await tx.invStockLevel.update({
            where: { id: source.id },
            data: { quantity: sourceAfter },
          })
        }
        if (sourceAfter < 0) {
          warnings.push(
            `재고가 부족합니다 (현재 재고: ${sourceBefore}, 이동 요청: ${input.quantity})`
          )
        }
        await upsertStockLevel(tx, spaceId, input.optionId, input.toLocationId, input.quantity)

        const movement = await tx.invMovement.create({
          data: {
            spaceId,
            optionId: input.optionId,
            locationId: input.locationId,
            toLocationId: input.toLocationId,
            type: 'TRANSFER',
            quantity: input.quantity,
            movementDate,
            reason: input.reason?.trim() || null,
            referenceId: input.referenceId ?? null,
            importHistoryId: input.importHistoryId ?? null,
          },
        })
        return { movement, stockLevelAfter: sourceAfter, warnings }
      }

      case 'ADJUSTMENT': {
        if (!input.optionId) throw new MovementError('optionId가 필요합니다', 400)
        if (!input.reason || !input.reason.trim()) {
          throw new MovementError('ADJUSTMENT는 reason이 필수입니다', 400)
        }
        await assertOptionInSpace(tx, spaceId, input.optionId)
        await lockStockLevel(tx, input.optionId, input.locationId)
        const existing = await tx.invStockLevel.findUnique({
          where: {
            optionId_locationId: { optionId: input.optionId, locationId: input.locationId },
          },
        })
        const before = existing?.quantity ?? 0
        const targetQuantity = input.quantity
        const delta = targetQuantity - before
        const { after } = await setStockLevel(
          tx,
          spaceId,
          input.optionId,
          input.locationId,
          targetQuantity
        )
        if (Math.abs(delta) / Math.max(1, before) >= 0.2) {
          warnings.push('대량 조정 감지')
        }
        const movement = await tx.invMovement.create({
          data: {
            spaceId,
            optionId: input.optionId,
            locationId: input.locationId,
            type: 'ADJUSTMENT',
            quantity: delta,
            movementDate,
            reason: input.reason.trim(),
            referenceId: input.referenceId ?? null,
            importHistoryId: input.importHistoryId ?? null,
          },
        })
        return { movement, stockLevelAfter: after, warnings }
      }

      default:
        throw new MovementError(`알 수 없는 이동 유형: ${String(input.type)}`, 400)
    }
  })
}

// 세트 조립·이관 — 구성옵션 여러 건을 한 출발지→도착지로 단일 트랜잭션에 모두 TRANSFER.
// processMovement(자체 트랜잭션 N건, best-effort)와 달리 all-or-nothing: 어느 옵션이든
// 출발지 재고가 요청량보다 적으면 어떤 write 도 하기 전에 전부 차단(조립 가능 초과 방지).
// components.quantity 는 이미 세트수×구성수량으로 합산된 옵션별 총 이관량.
export type SetTransferComponent = { optionId: string; quantity: number }

export type SetTransferInput = {
  components: SetTransferComponent[]
  fromLocationId: string
  toLocationId: string
  movementDate: string
  reason?: string
  referenceId?: string
}

export async function processSetTransfer(
  spaceId: string,
  input: SetTransferInput
): Promise<{
  movements: InvMovement[]
  transferred: Array<{ optionId: string; quantity: number; fromAfter: number }>
}> {
  if (!input.fromLocationId || !input.toLocationId) {
    throw new MovementError('출발지·도착지 위치가 필요합니다', 400)
  }
  if (input.fromLocationId === input.toLocationId) {
    throw new MovementError('출발지와 도착지가 동일할 수 없습니다', 400)
  }

  // 옵션별 합산(같은 옵션이 여러 세트에 걸쳐 있을 수 있음) + 양수 정수만
  const demand = new Map<string, number>()
  for (const c of input.components) {
    if (!c.optionId) continue
    if (!Number.isInteger(c.quantity) || c.quantity <= 0) continue
    demand.set(c.optionId, (demand.get(c.optionId) ?? 0) + c.quantity)
  }
  if (demand.size === 0) {
    throw new MovementError('이관할 구성옵션이 없습니다', 400)
  }

  const movementDate = parseDate(input.movementDate, 'movementDate')

  return await prisma.$transaction(async (tx) => {
    await assertLocationInSpace(tx, spaceId, input.fromLocationId, '출발 보관 장소')
    await assertLocationInSpace(tx, spaceId, input.toLocationId, '도착 보관 장소')

    // 결정론적 잠금 순서((optionId, locationId) 전역 정렬)로 데드락 최소화
    const lockPairs: Array<{ optionId: string; locationId: string }> = []
    for (const optionId of demand.keys()) {
      lockPairs.push({ optionId, locationId: input.fromLocationId })
      lockPairs.push({ optionId, locationId: input.toLocationId })
    }
    lockPairs.sort((a, b) =>
      a.optionId === b.optionId
        ? a.locationId.localeCompare(b.locationId)
        : a.optionId.localeCompare(b.optionId)
    )
    for (const p of lockPairs) {
      await lockStockLevel(tx, p.optionId, p.locationId)
    }

    // 옵션 검증 + 조립 가능 초과 사전 차단 (어떤 write 도 하기 전에 전부 검사)
    const shortfalls: string[] = []
    const sourceByOption = new Map<
      string,
      { stockId: string | null; before: number; optionName: string }
    >()
    for (const [optionId, qty] of demand) {
      const option = await assertOptionInSpace(tx, spaceId, optionId)
      const src = await tx.invStockLevel.findUnique({
        where: { optionId_locationId: { optionId, locationId: input.fromLocationId } },
      })
      const before = src?.quantity ?? 0
      sourceByOption.set(optionId, { stockId: src?.id ?? null, before, optionName: option.name })
      if (qty > before) {
        shortfalls.push(`${option.name} (필요 ${qty}, 보유 ${before})`)
      }
    }
    if (shortfalls.length > 0) {
      throw new MovementError(
        `자체창고 재고가 부족해 조립할 수 없습니다: ${shortfalls.join(', ')}`,
        400
      )
    }

    // 전부 통과 → from 차감 + to 가산 + movement 생성 (음수 재고 발생 없음)
    const movements: InvMovement[] = []
    const transferred: Array<{ optionId: string; quantity: number; fromAfter: number }> = []
    for (const [optionId, qty] of demand) {
      const src = sourceByOption.get(optionId)!
      const fromAfter = src.before - qty
      if (src.stockId) {
        await tx.invStockLevel.update({ where: { id: src.stockId }, data: { quantity: fromAfter } })
      } else {
        await tx.invStockLevel.create({
          data: { spaceId, optionId, locationId: input.fromLocationId, quantity: fromAfter },
        })
      }
      await upsertStockLevel(tx, spaceId, optionId, input.toLocationId, qty)
      const movement = await tx.invMovement.create({
        data: {
          spaceId,
          optionId,
          locationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          type: 'TRANSFER',
          quantity: qty,
          movementDate,
          reason: input.reason?.trim() || null,
          referenceId: input.referenceId ?? null,
        },
      })
      movements.push(movement)
      transferred.push({ optionId, quantity: qty, fromAfter })
    }
    return { movements, transferred }
  })
}

/**
 * 이동 효과를 stock에 반대 부호로 적용해 재고 원상복구.
 * 트랜잭션 내에서 호출, lockStockLevel은 호출 측이 미리 잡고 호출하는 것을 가정.
 * 행 자체의 삭제/업데이트는 호출 측이 처리한다.
 */
export async function reverseMovement(
  tx: Tx,
  spaceId: string,
  movement: InvMovement
): Promise<void> {
  const { type, optionId, locationId, toLocationId, quantity } = movement
  switch (type) {
    case 'INBOUND':
    case 'RETURN':
      await upsertStockLevel(tx, spaceId, optionId, locationId, -quantity)
      return
    case 'OUTBOUND':
      await upsertStockLevel(tx, spaceId, optionId, locationId, quantity)
      return
    case 'TRANSFER':
      if (!toLocationId) throw new MovementError('TRANSFER 역산 실패: toLocationId 누락', 500)
      await upsertStockLevel(tx, spaceId, optionId, locationId, quantity)
      await upsertStockLevel(tx, spaceId, optionId, toLocationId, -quantity)
      return
    case 'ADJUSTMENT':
      // quantity는 delta로 저장됨. 반대 부호로 stock 갱신.
      await upsertStockLevel(tx, spaceId, optionId, locationId, -quantity)
      return
  }
}
