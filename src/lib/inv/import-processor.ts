// 재고 이동 대량 가져오기 프로세서
// 파싱된 행을 100개 단위 배치로 processMovement에 위임하고 결과를 InvImportHistory에 기록한다.
// processMovement가 내부적으로 $transaction을 사용하므로 외부 트랜잭션으로 감싸지 않는다.

import { prisma } from '@/lib/prisma'
import {
  processMovement,
  MovementError,
  type MovementInput,
  type MovementType,
} from '@/lib/inv/movement-processor'
import type { ParsedImportRow, ImportParseError } from '@/lib/inv/import-parser'

const BATCH_SIZE = 100

export type ImportRowError = { row: number; message: string }

export type ProcessImportResult = {
  importHistoryId: string
  totalRows: number
  successRows: number
  errorRows: number
  errors: ImportRowError[]
}

type OptionLookup = {
  id: string
  productName: string
  optionName: string
}

// 공간 내 (productName + optionName) 키로 옵션 ID 조회 맵을 구성한다.
// 동일 키에 여러 매칭이 있으면 id를 '__AMBIGUOUS__' 로 표시하여 행 단위 에러를 내도록 한다.
async function buildOptionMap(spaceId: string): Promise<Map<string, string>> {
  const options = await prisma.invProductOption.findMany({
    where: { product: { spaceId } },
    select: {
      id: true,
      name: true,
      product: { select: { name: true } },
    },
  })
  const map = new Map<string, string>()
  for (const o of options) {
    const key = `${o.product.name}\u0000${o.name}`
    if (map.has(key)) {
      map.set(key, '__AMBIGUOUS__')
    } else {
      map.set(key, o.id)
    }
  }
  return map
}

async function buildLocationMap(spaceId: string): Promise<Map<string, string>> {
  const locs = await prisma.invStorageLocation.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true },
  })
  const map = new Map<string, string>()
  for (const l of locs) map.set(l.name, l.id)
  return map
}

async function buildChannelMap(spaceId: string): Promise<Map<string, string>> {
  const channels = await prisma.invSalesChannel.findMany({
    where: { spaceId, isActive: true },
    select: { id: true, name: true },
  })
  const map = new Map<string, string>()
  for (const c of channels) map.set(c.name, c.id)
  return map
}

type ResolverContext = {
  spaceId: string
  locations: Map<string, string>
  channels: Map<string, string>
  options: Map<string, string>
  defaultLocationId: string | null
  importHistoryId: string
}

function resolveLocationId(row: ParsedImportRow, ctx: ResolverContext): string {
  if (row.locationName) {
    const id = ctx.locations.get(row.locationName)
    if (!id) throw new Error(`위치를 찾을 수 없습니다: "${row.locationName}"`)
    return id
  }
  if (ctx.defaultLocationId) return ctx.defaultLocationId
  throw new Error('위치가 지정되지 않았고 기본 위치도 없습니다')
}

function resolveExistingOptionId(row: ParsedImportRow, ctx: ResolverContext): string {
  const key = `${row.productName}\u0000${row.optionName}`
  const id = ctx.options.get(key)
  if (!id) {
    throw new Error(`상품 옵션을 찾을 수 없습니다: "${row.productName} / ${row.optionName}"`)
  }
  if (id === '__AMBIGUOUS__') {
    throw new Error(
      `동일 상품/옵션명을 가진 항목이 여러 개 존재합니다: "${row.productName} / ${row.optionName}"`,
    )
  }
  return id
}

function rowToMovementInput(row: ParsedImportRow, ctx: ResolverContext): MovementInput {
  const type = row.type as MovementType
  const locationId = resolveLocationId(row, ctx)

  const base: MovementInput = {
    type,
    locationId,
    quantity: row.quantity,
    movementDate: row.movementDate,
    importHistoryId: ctx.importHistoryId,
  }

  switch (type) {
    case 'INBOUND': {
      return {
        ...base,
        productName: row.productName,
        productCode: row.productCode ?? null,
        optionName: row.optionName,
        optionSku: row.sku ?? null,
      }
    }
    case 'OUTBOUND': {
      if (!row.channelName) throw new Error('판매채널이 필요합니다 (출고)')
      const channelId = ctx.channels.get(row.channelName)
      if (!channelId) throw new Error(`판매채널을 찾을 수 없습니다: "${row.channelName}"`)
      return {
        ...base,
        optionId: resolveExistingOptionId(row, ctx),
        channelId,
        orderDate: row.orderDate,
      }
    }
    case 'RETURN': {
      return {
        ...base,
        optionId: resolveExistingOptionId(row, ctx),
      }
    }
    case 'TRANSFER': {
      if (!row.toLocationName) throw new Error('도착위치가 필요합니다 (이동)')
      const toLocationId = ctx.locations.get(row.toLocationName)
      if (!toLocationId) throw new Error(`도착위치를 찾을 수 없습니다: "${row.toLocationName}"`)
      return {
        ...base,
        optionId: resolveExistingOptionId(row, ctx),
        toLocationId,
      }
    }
    case 'ADJUSTMENT': {
      if (!row.reason) throw new Error('조정 행은 사유가 필수입니다')
      return {
        ...base,
        optionId: resolveExistingOptionId(row, ctx),
        reason: row.reason,
      }
    }
    default:
      throw new Error(`알 수 없는 이동 유형: ${String(type)}`)
  }
}

export async function processImport(
  spaceId: string,
  fileName: string,
  rows: ParsedImportRow[],
  parseErrors: ImportParseError[],
): Promise<ProcessImportResult> {
  const fileType = /\.csv$/i.test(fileName) ? 'CSV' : 'EXCEL'

  // 1. 이력 레코드 선생성
  const history = await prisma.invImportHistory.create({
    data: {
      spaceId,
      fileName,
      fileType,
      totalRows: rows.length + parseErrors.length,
      successRows: 0,
      errorRows: parseErrors.length,
    },
  })

  // 2. 사전 조회 맵
  const [locations, channels, options] = await Promise.all([
    buildLocationMap(spaceId),
    buildChannelMap(spaceId),
    buildOptionMap(spaceId),
  ])

  const ctx: ResolverContext = {
    spaceId,
    locations,
    channels,
    options,
    defaultLocationId: null,
    importHistoryId: history.id,
  }

  const errors: ImportRowError[] = [...parseErrors]
  let successCount = 0

  // 3. 100건 단위 배치 — 각 행은 자기 자신의 processMovement 트랜잭션을 갖는다 (중첩 금지)
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    for (const row of batch) {
      try {
        const input = rowToMovementInput(row, ctx)
        await processMovement(spaceId, input)

        // INBOUND 행은 새 옵션을 생성할 수 있으므로 옵션 맵을 즉시 갱신하여 후속 행에서 참조 가능하게 한다.
        if (row.type === 'INBOUND') {
          const key = `${row.productName}\u0000${row.optionName}`
          if (!ctx.options.has(key)) {
            const created = await prisma.invProductOption.findFirst({
              where: {
                name: row.optionName,
                product: { spaceId, name: row.productName },
              },
              select: { id: true },
            })
            if (created) ctx.options.set(key, created.id)
          }
        }
        successCount += 1
      } catch (err) {
        const message =
          err instanceof MovementError
            ? err.message
            : err instanceof Error
              ? err.message
              : '알 수 없는 오류'
        errors.push({ row: row.rowNumber, message })
      }
    }
  }

  const totalRows = rows.length + parseErrors.length
  const errorRows = errors.length

  // 4. 최종 이력 업데이트
  await prisma.invImportHistory.update({
    where: { id: history.id },
    data: {
      totalRows,
      successRows: successCount,
      errorRows,
      errors: errors.length > 0 ? errors : undefined,
    },
  })

  return {
    importHistoryId: history.id,
    totalRows,
    successRows: successCount,
    errorRows,
    errors,
  }
}
