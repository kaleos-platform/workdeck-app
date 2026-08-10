// 대조 스냅샷(matchResults) 후처리 — 저장 시점 이후 생긴 매핑을 반영해 file-only 를 풀어준다.
//
// matchResults 는 매칭 당시의 스냅샷이라, 그 뒤 사용자가 [상품 선택]/[쿠팡 SKU 연결]로
// InvLocationProductMap 을 만들어도 JSON 은 그대로 file-only 로 남는다. 상세 GET 과
// 수동 확정이 같은 규칙으로 이 차이를 흡수해야 "매칭했는데 재고가 안 바뀌는" 괴리가 안 생긴다.
import { prisma } from '@/lib/prisma'
import type { MatchEntry, FileOnlyEntry } from './reconciliation-matcher'

/**
 * file-only 항목 중 InvLocationProductMap에 매핑이 생긴 것을
 * 현재 InvStockLevel 기준으로 N entries (matched-equal/matched-diff)로 변환한다.
 * items 수만큼 entry 분리. 매핑이 없는 file-only는 그대로 유지.
 */
export async function resolveFileOnlyEntries(
  entries: MatchEntry[],
  reconLocationId: string
): Promise<MatchEntry[]> {
  const fileOnlyEntries = entries.filter((e): e is FileOnlyEntry => e.status === 'file-only')
  if (fileOnlyEntries.length === 0) return entries

  // (locationId, externalCode) 페어 수집
  const codesByLoc = new Map<string, Set<string>>()
  for (const e of fileOnlyEntries) {
    if (!e.row.externalCode) continue
    const locId = e.locationId ?? reconLocationId
    const s = codesByLoc.get(locId) ?? new Set()
    s.add(e.row.externalCode)
    codesByLoc.set(locId, s)
  }
  if (codesByLoc.size === 0) return entries

  type MappingFull = {
    items: {
      optionId: string
      quantity: number
      option: { name: string; product: { name: string } }
    }[]
  }
  const mappingByKey = new Map<string, MappingFull>() // `${locId}|${code}`
  const stockByKey = new Map<string, number>() // `${locId}|${optionId}`

  for (const [locId, codeSet] of codesByLoc) {
    const mappings = await prisma.invLocationProductMap.findMany({
      where: { locationId: locId, externalCode: { in: Array.from(codeSet) } },
      include: {
        items: {
          include: {
            option: { include: { product: { select: { name: true } } } },
          },
        },
      },
    })
    for (const m of mappings) {
      mappingByKey.set(`${locId}|${m.externalCode}`, { items: m.items })
    }
    const optionIds = mappings.flatMap((m) => m.items.map((i) => i.optionId))
    if (optionIds.length === 0) continue
    const stocks = await prisma.invStockLevel.findMany({
      where: { locationId: locId, optionId: { in: optionIds } },
    })
    for (const s of stocks) stockByKey.set(`${locId}|${s.optionId}`, s.quantity)
  }

  const result: MatchEntry[] = []
  for (const entry of entries) {
    if (entry.status !== 'file-only') {
      result.push(entry)
      continue
    }
    const locId = entry.locationId ?? reconLocationId
    if (!entry.row.externalCode) {
      result.push(entry)
      continue
    }
    const mapping = mappingByKey.get(`${locId}|${entry.row.externalCode}`)
    if (!mapping || mapping.items.length === 0) {
      result.push(entry)
      continue
    }

    for (const item of mapping.items) {
      const systemQty = stockByKey.get(`${locId}|${item.optionId}`) ?? 0
      const fileQty = entry.row.quantity * item.quantity

      if (fileQty === systemQty) {
        result.push({
          status: 'matched-equal' as const,
          row: entry.row,
          optionId: item.optionId,
          locationId: locId,
          productName: item.option.product.name,
          optionName: item.option.name,
          mapItemQuantity: item.quantity,
          systemQuantity: systemQty,
          fileQuantity: fileQty,
        })
      } else {
        result.push({
          status: 'matched-diff' as const,
          row: entry.row,
          optionId: item.optionId,
          locationId: locId,
          productName: item.option.product.name,
          optionName: item.option.name,
          mapItemQuantity: item.quantity,
          systemQuantity: systemQty,
          fileQuantity: fileQty,
          delta: fileQty - systemQty,
        })
      }
    }
  }

  return result
}
