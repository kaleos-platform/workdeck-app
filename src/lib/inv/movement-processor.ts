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
async function lockStockLevel(tx: Tx, optionId: string, locationId: string): Promise<void> {
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
    include: { product: { select: { spaceId: true } } },
  })
  if (!option || option.product.spaceId !== spaceId) {
    throw new MovementError('상품 옵션을 찾을 수 없습니다', 404)
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
      where: { spaceId, code: input.productCode },
    })
  }
  if (!product) {
    product = await tx.invProduct.findFirst({
      where: { spaceId, name: productName },
    })
  }
  if (!product) {
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
