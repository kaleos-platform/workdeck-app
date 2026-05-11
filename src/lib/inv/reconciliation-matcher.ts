// 재고 대조 매처 — 파일 파싱 결과를 InvLocationProductMap 기반으로 시스템 재고에 매칭한다.
// 1:N 매핑: 외부코드 1개 → items[] N개, file 1행이 N개의 entry로 분리된다.
import { prisma } from '@/lib/prisma'
import type { ParsedRow, ParseResult } from './reconciliation-parser'

export type SuggestionOption = {
  optionId: string
  productName: string
  optionName: string
}

export type MatchedDiffEntry = {
  status: 'matched-diff'
  row: ParsedRow
  optionId: string
  productName: string
  optionName: string
  mapItemQuantity: number // item.quantity (수량 비율)
  systemQuantity: number
  fileQuantity: number // row.quantity * item.quantity
  delta: number
}

export type MatchedEqualEntry = {
  status: 'matched-equal'
  row: ParsedRow
  optionId: string
  productName: string
  optionName: string
  mapItemQuantity: number
  systemQuantity: number
  fileQuantity: number // row.quantity * item.quantity
}

export type FileOnlyEntry = {
  status: 'file-only'
  row: ParsedRow
  suggestions: SuggestionOption[]
}

export type SystemOnlyEntry = {
  status: 'system-only'
  optionId: string
  productName: string
  optionName: string
  systemQuantity: number
}

export type MatchEntry = MatchedDiffEntry | MatchedEqualEntry | FileOnlyEntry | SystemOnlyEntry

export type MatchReconciliationResult = {
  entries: MatchEntry[]
  totalItems: number
  matchedItems: number
}

// 간단 LIKE 기반 유사 옵션 후보 (최대 5개)
async function findSuggestions(spaceId: string, row: ParsedRow): Promise<SuggestionOption[]> {
  const name = row.externalName?.trim()
  if (!name) return []
  const token = name.length > 2 ? name.slice(0, Math.min(10, name.length)) : name

  const options = await prisma.invProductOption.findMany({
    where: {
      product: { spaceId, name: { contains: token, mode: 'insensitive' } },
    },
    include: { product: { select: { name: true } } },
    take: 5,
    orderBy: { createdAt: 'desc' },
  })

  return options.map((o) => ({
    optionId: o.id,
    productName: o.product.name,
    optionName: o.name,
  }))
}

export async function matchReconciliation(
  spaceId: string,
  locationId: string,
  parsed: ParseResult
): Promise<MatchReconciliationResult> {
  const entries: MatchEntry[] = []

  // 1) 외부코드 → 매핑(+items) 로드 (배치)
  const externalCodes = Array.from(new Set(parsed.rows.map((r) => r.externalCode)))
  const mappings = await prisma.invLocationProductMap.findMany({
    where: { locationId, externalCode: { in: externalCodes } },
    include: {
      items: {
        include: {
          option: { include: { product: { select: { name: true } } } },
        },
      },
    },
  })
  const mappingByCode = new Map<string, (typeof mappings)[number]>()
  for (const m of mappings) mappingByCode.set(m.externalCode, m)

  // 2) 매핑된 모든 optionId의 StockLevel 배치 조회
  const mappedOptionIds = mappings.flatMap((m) => m.items.map((i) => i.optionId))
  const stocks = await prisma.invStockLevel.findMany({
    where: { locationId, optionId: { in: mappedOptionIds } },
  })
  const stockByOption = new Map<string, number>()
  for (const s of stocks) stockByOption.set(s.optionId, s.quantity)

  const matchedOptionIds = new Set<string>()
  let matchedItems = 0

  for (const row of parsed.rows) {
    const mapping = mappingByCode.get(row.externalCode)
    if (mapping && mapping.items.length > 0) {
      matchedItems += 1
      // 1행 → N entries (items 수만큼 분리)
      for (const item of mapping.items) {
        matchedOptionIds.add(item.optionId)
        const systemQty = stockByOption.get(item.optionId) ?? 0
        const fileQty = row.quantity * item.quantity
        if (systemQty === fileQty) {
          entries.push({
            status: 'matched-equal',
            row,
            optionId: item.optionId,
            productName: item.option.product.name,
            optionName: item.option.name,
            mapItemQuantity: item.quantity,
            systemQuantity: systemQty,
            fileQuantity: fileQty,
          })
        } else {
          entries.push({
            status: 'matched-diff',
            row,
            optionId: item.optionId,
            productName: item.option.product.name,
            optionName: item.option.name,
            mapItemQuantity: item.quantity,
            systemQuantity: systemQty,
            fileQuantity: fileQty,
            delta: fileQty - systemQty,
          })
        }
      }
    } else {
      // 매핑 없거나 items가 비어있으면 file-only
      const suggestions = await findSuggestions(spaceId, row)
      entries.push({ status: 'file-only', row, suggestions })
    }
  }

  // 3) system-only: 이 위치에 재고가 있지만 파일에는 없는 옵션들
  const systemStocks = await prisma.invStockLevel.findMany({
    where: { locationId, quantity: { gt: 0 } },
    include: {
      option: { include: { product: { select: { name: true } } } },
    },
  })
  for (const s of systemStocks) {
    if (matchedOptionIds.has(s.optionId)) continue
    entries.push({
      status: 'system-only',
      optionId: s.optionId,
      productName: s.option.product.name,
      optionName: s.option.name,
      systemQuantity: s.quantity,
    })
  }

  return {
    entries,
    totalItems: parsed.rows.length,
    matchedItems,
  }
}
