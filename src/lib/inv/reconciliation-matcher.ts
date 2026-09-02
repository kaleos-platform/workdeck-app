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
  locationId: string
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
  locationId: string
  productName: string
  optionName: string
  mapItemQuantity: number
  systemQuantity: number
  fileQuantity: number // row.quantity * item.quantity
}

export type FileOnlyEntry = {
  status: 'file-only'
  row: ParsedRow
  locationId: string
  suggestions: SuggestionOption[]
}

export type SystemOnlyEntry = {
  status: 'system-only'
  optionId: string
  locationId: string
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
      deletedAt: null, // 삭제된 옵션은 추천하지 않는다
      product: {
        spaceId,
        // 파일 상품명은 정식명(name)일 수도, 관리명(internalName)일 수도 있다.
        OR: [
          { name: { contains: token, mode: 'insensitive' } },
          { internalName: { contains: token, mode: 'insensitive' } },
        ],
      },
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

// 이름으로 단일 옵션 매칭 — productName+optionName 정확 일치(대소문자 무시).
// 단일 매칭만 매칭으로 인정, 0건/2건 이상은 null.
async function findOptionByName(
  spaceId: string,
  productName: string,
  optionName: string
): Promise<{ optionId: string; productName: string; optionName: string } | null> {
  const options = await prisma.invProductOption.findMany({
    where: {
      name: { equals: optionName, mode: 'insensitive' },
      deletedAt: null, // 삭제된 옵션에 파일 행이 다시 붙지 않도록 제외
      // 앱 재고현황 export는 상품명 칸에 관리명(internalName)을 쓴다 → 둘 다 본다.
      product: {
        spaceId,
        OR: [
          { name: { equals: productName, mode: 'insensitive' } },
          { internalName: { equals: productName, mode: 'insensitive' } },
        ],
      },
    },
    include: { product: { select: { name: true } } },
    take: 2,
  })
  if (options.length !== 1) return null
  const o = options[0]
  return { optionId: o.id, productName: o.product.name, optionName: o.name }
}

// 단일 옵션 상품 매칭 — 상품명만으로(옵션명 무시). 외부 파일이 변형 없이 "Default" 옵션만
// 담는 경우(단일 옵션 상품)를 위해. 상품명 정확 일치 상품이 딱 1개이고 그 상품의 옵션이
// 딱 1개일 때만 매칭(모호하면 null → file-only). 다중 옵션/동명 상품은 매칭 안 함.
async function findSingleOptionByProductName(
  spaceId: string,
  productName: string
): Promise<{ optionId: string; productName: string; optionName: string } | null> {
  const products = await prisma.invProduct.findMany({
    where: {
      spaceId,
      OR: [
        { name: { equals: productName, mode: 'insensitive' } },
        { internalName: { equals: productName, mode: 'insensitive' } },
      ],
    },
    include: { options: { where: { deletedAt: null }, select: { id: true, name: true } } },
    take: 2,
  })
  if (products.length !== 1) return null
  const p = products[0]
  if (p.options.length !== 1) return null
  const o = p.options[0]
  return { optionId: o.id, productName: p.name, optionName: o.name }
}

export async function matchReconciliation(
  spaceId: string,
  locationId: string,
  parsed: ParseResult
): Promise<MatchReconciliationResult> {
  const entries: MatchEntry[] = []

  // 1) externalCode 매핑 일괄 로드 (있는 행만)
  const externalCodes = Array.from(
    new Set(parsed.rows.map((r) => r.externalCode).filter((c): c is string => !!c))
  )
  const mappings = externalCodes.length
    ? await prisma.invLocationProductMap.findMany({
        where: { locationId, externalCode: { in: externalCodes } },
        include: {
          items: {
            include: {
              option: { include: { product: { select: { name: true } } } },
            },
          },
        },
      })
    : []
  const mappingByCode = new Map<string, (typeof mappings)[number]>()
  for (const m of mappings) mappingByCode.set(m.externalCode, m)

  // 2) 매핑된 모든 optionId의 StockLevel 배치 조회 (이름 fallback 매칭분은 개별 조회)
  const mappedOptionIds = mappings.flatMap((m) => m.items.map((i) => i.optionId))
  const stocks = await prisma.invStockLevel.findMany({
    where: { locationId, optionId: { in: mappedOptionIds } },
  })
  const stockByOption = new Map<string, number>()
  for (const s of stocks) stockByOption.set(s.optionId, s.quantity)

  const matchedOptionIds = new Set<string>()
  let matchedItems = 0

  function pushMatch(
    row: ParsedRow,
    optionId: string,
    productName: string,
    optionName: string,
    mapItemQuantity: number,
    systemQty: number
  ) {
    matchedOptionIds.add(optionId)
    const fileQty = row.quantity * mapItemQuantity
    if (systemQty === fileQty) {
      entries.push({
        status: 'matched-equal',
        row,
        optionId,
        locationId,
        productName,
        optionName,
        mapItemQuantity,
        systemQuantity: systemQty,
        fileQuantity: fileQty,
      })
    } else {
      entries.push({
        status: 'matched-diff',
        row,
        optionId,
        locationId,
        productName,
        optionName,
        mapItemQuantity,
        systemQuantity: systemQty,
        fileQuantity: fileQty,
        delta: fileQty - systemQty,
      })
    }
  }

  for (const row of parsed.rows) {
    // 1순위: externalCode 매핑
    const mapping = row.externalCode ? mappingByCode.get(row.externalCode) : undefined
    if (mapping && mapping.items.length > 0) {
      matchedItems += 1
      for (const item of mapping.items) {
        const systemQty = stockByOption.get(item.optionId) ?? 0
        pushMatch(
          row,
          item.optionId,
          item.option.product.name,
          item.option.name,
          item.quantity,
          systemQty
        )
      }
      continue
    }

    // 2순위: 이름 fallback
    //  (a) 상품명+옵션명 단일 일치, 또는
    //  (b) 단일 옵션 상품이면 상품명만으로(옵션명 "Default" 등 무시)
    if (row.externalName) {
      let hit = row.externalOptionName
        ? await findOptionByName(spaceId, row.externalName, row.externalOptionName)
        : null
      if (!hit) hit = await findSingleOptionByProductName(spaceId, row.externalName)
      if (hit) {
        const sysRow = await prisma.invStockLevel.findUnique({
          where: { optionId_locationId: { optionId: hit.optionId, locationId } },
          select: { quantity: true },
        })
        matchedItems += 1
        pushMatch(row, hit.optionId, hit.productName, hit.optionName, 1, sysRow?.quantity ?? 0)
        continue
      }
    }

    // 매칭 실패 → file-only
    const suggestions = await findSuggestions(spaceId, row)
    entries.push({ status: 'file-only', row, locationId, suggestions })
  }

  // 3) system-only: 이 위치에 재고가 있지만 파일에는 없는 옵션들
  // stock_status_export 포맷은 "변동 없는 행은 스킵"하는 sparse 의미 → 부재 ≠ 삭제.
  // 모든 옵션에 대해 system-only 띄우면 미리보기가 망가지므로 생략한다.
  if (parsed.format !== 'stock_status_export') {
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
        locationId,
        productName: s.option.product.name,
        optionName: s.option.name,
        systemQuantity: s.quantity,
      })
    }
  }

  return {
    entries,
    totalItems: parsed.rows.length,
    matchedItems,
  }
}
