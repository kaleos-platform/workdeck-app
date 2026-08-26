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

/**
 * matched-* 항목의 systemQuantity/delta 를 현재 InvStockLevel 기준으로 다시 계산하고
 * matched-equal ↔ matched-diff 를 재분류한다.
 *
 * matchResults 에 저장된 systemQuantity 는 **매칭 시점** 값이다. 두 달 전 대조를 열면
 * 화면이 그때의 재고를 보여주는데, 확정은 fileQuantity 로 절대량 set 을 하므로
 * "차이 +1154" 라고 표시하고 실제로는 96 → 120 이 되는 괴리가 생긴다.
 * 판단 근거로 보여주는 숫자와 실제 결과를 일치시킨다.
 *
 * fileQuantity/mapItemQuantity/row 는 파일에서 온 값이라 건드리지 않는다.
 *
 * 주의: 이걸 통과하면 "대조 당시엔 일치했지만 이후 재고가 변동된" 행이 matched-diff 로
 * 바뀌어 확정 대상에 새로 들어온다. 호출측이 driftedSinceMatch 로 그 건수를 사용자에게
 * 드러내야 한다(조용히 적용 범위를 넓히면 안 된다).
 * 확정이 끝난(CONFIRMED) 대조는 닫힌 기록이므로 호출하지 않는다 — 확정 후 정상적인
 * 입출고로 재고가 움직인 것을 "차이"로 표시하면 성공한 대조가 실패한 것처럼 보인다.
 */
export async function refreshMatchedQuantities(
  entries: MatchEntry[],
  reconLocationId: string
): Promise<(MatchEntry & { driftedSinceMatch?: boolean })[]> {
  const matched = entries.filter(
    (e) => e.status === 'matched-diff' || e.status === 'matched-equal'
  ) as Extract<MatchEntry, { status: 'matched-diff' | 'matched-equal' }>[]
  if (matched.length === 0) return entries

  // (locationId, optionId) 페어를 위치별로 묶어 배치 조회
  const optionsByLoc = new Map<string, Set<string>>()
  for (const e of matched) {
    const locId = e.locationId ?? reconLocationId
    const s = optionsByLoc.get(locId) ?? new Set()
    s.add(e.optionId)
    optionsByLoc.set(locId, s)
  }

  const liveByKey = new Map<string, number>() // `${locId}|${optionId}`
  for (const [locId, optionIds] of optionsByLoc) {
    const stocks = await prisma.invStockLevel.findMany({
      where: { locationId: locId, optionId: { in: Array.from(optionIds) } },
      select: { optionId: true, quantity: true },
    })
    for (const s of stocks) liveByKey.set(`${locId}|${s.optionId}`, s.quantity)
  }

  return entries.map((e) => {
    if (e.status !== 'matched-diff' && e.status !== 'matched-equal') return e
    const locId = e.locationId ?? reconLocationId
    const liveQty = liveByKey.get(`${locId}|${e.optionId}`) ?? 0 // 재고 행 없는 옵션 = 0
    if (liveQty === e.systemQuantity) return e // 변동 없음 — 그대로 둔다

    const base = {
      row: e.row,
      optionId: e.optionId,
      locationId: e.locationId,
      productName: e.productName,
      optionName: e.optionName,
      mapItemQuantity: e.mapItemQuantity,
      fileQuantity: e.fileQuantity,
      systemQuantity: liveQty,
    }
    if (liveQty === e.fileQuantity) {
      return { ...e, ...base, status: 'matched-equal' as const, delta: undefined }
    }
    return {
      ...e,
      ...base,
      status: 'matched-diff' as const,
      delta: e.fileQuantity - liveQty,
      // 대조 당시엔 일치했는데 이후 재고가 움직여 차이가 생긴 행
      ...(e.status === 'matched-equal' ? { driftedSinceMatch: true } : {}),
    }
  })
}
