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

/**
 * 같은 (locationId, optionId) 를 가리키는 matched-* 엔트리를 **옵션 단위로 합산**한다.
 *
 * 하나의 내부 옵션을 여러 외부 SKU 가 가리킬 수 있다(1장 / 3장 세트 / 5장 세트 / 혼합 2색
 * 세트 …). 매처는 파일 행 × 매핑 아이템 단위로 엔트리를 만들고 각 엔트리가 독립적인
 * fileQuantity(= row.quantity × mapItemQuantity)를 갖는데, ADJUSTMENT 는 **절대량 set** 이라
 * 이 값들을 순차 적용하면 마지막(또는 처음) 하나만 남고 나머지는 통째로 버려진다.
 * 그래서 확정해도 재고가 안 맞고, 재대조하면 같은 차이가 다시 뜬다.
 *
 * 옵션의 실제 시스템 목표 재고 = Σ(모든 멤버의 fileQuantity) 다.
 * 예) 1장 3개 + 3장세트 0개(×3) + 5장세트 0개(×5) → 목표 3, 차이는 한 건.
 *
 * 왜 매칭 시점이 아니라 여기서 파생하는가:
 *  - resolveFileOnlyEntries 가 매칭 당시 없던 matched 엔트리를 사후에 만든다. 매처에서
 *    합계를 동결하면 나중에 생긴 형제 엔트리가 합계에서 빠진다.
 *  - PATCH .../mappings 로 mapItemQuantity 자체가 바뀌므로 동결값은 즉시 stale 이 된다.
 *  - matchResults JSON 스키마를 안 건드리므로 기존 저장 세션 호환 분기가 필요 없다.
 *
 * 호출 순서 고정: resolveFileOnlyEntries → refreshMatchedQuantities → aggregateMatchedByOption.
 * aggregate 를 refresh 앞에 두면 재계산 전 systemQuantity 로 그룹을 판정하게 된다.
 *
 * 불변식: 같은 (locationId, optionId) 의 모든 matched-* 엔트리는 동일한 systemQuantity 를
 * 갖는다(matcher/resolve/refresh 모두 옵션당 한 번만 재고를 조회한다). 이게 깨지면
 * groupDelta = groupFileQuantity - systemQuantity 가 무의미해진다.
 */
export type GroupedMatchEntry = MatchEntry & {
  /** `${locationId}|${optionId}` — 같은 값이면 같은 내부 옵션을 가리키는 형제 행 */
  groupKey?: string
  /** Σ(멤버 fileQuantity) = 이 옵션에 set 할 절대 목표 수량 */
  groupFileQuantity?: number
  groupMemberCount?: number
  groupDelta?: number
  /** 그룹 내 첫 엔트리 — 조정/카운트의 대표 행 */
  isGroupPrimary?: boolean
  driftedSinceMatch?: boolean
}

export function aggregateMatchedByOption(
  entries: (MatchEntry & { driftedSinceMatch?: boolean })[],
  reconLocationId: string
): GroupedMatchEntry[] {
  const keyOf = (e: Extract<MatchEntry, { status: 'matched-diff' | 'matched-equal' }>) =>
    `${e.locationId ?? reconLocationId}|${e.optionId}`

  const sum = new Map<string, number>()
  const memberCount = new Map<string, number>()
  const anyDrift = new Map<string, boolean>()

  for (const e of entries) {
    if (e.status !== 'matched-diff' && e.status !== 'matched-equal') continue
    const key = keyOf(e)
    sum.set(key, (sum.get(key) ?? 0) + e.fileQuantity)
    memberCount.set(key, (memberCount.get(key) ?? 0) + 1)
    // OR 집계 — driftedSinceMatch 는 "원래 equal 이었다가 diff 가 된" 엔트리에만 붙으므로
    // AND 로 모으면 멤버가 섞인 그룹에서 실제 drift 가 false 로 사라진다.
    if (e.driftedSinceMatch) anyDrift.set(key, true)
  }

  const seen = new Set<string>()
  return entries.map((e): GroupedMatchEntry => {
    if (e.status !== 'matched-diff' && e.status !== 'matched-equal') return e
    const key = keyOf(e)
    const groupFileQuantity = sum.get(key) ?? e.fileQuantity
    const groupDelta = groupFileQuantity - e.systemQuantity
    const isGroupPrimary = !seen.has(key)
    seen.add(key)

    const groupFields = {
      groupKey: key,
      groupFileQuantity,
      groupMemberCount: memberCount.get(key) ?? 1,
      groupDelta,
      isGroupPrimary,
    }

    // 개별 행은 diff 여도 그룹 합계가 시스템 재고와 같으면 조정할 것이 없다.
    if (groupDelta === 0) {
      // delta/driftedSinceMatch 는 키 자체를 지운다 — undefined 로 두면 matched-equal
      // 타입에 없는 프로퍼티가 남아 JSON 직렬화와 타입이 어긋난다.
      const {
        delta: _delta,
        driftedSinceMatch: _drift,
        ...rest
      } = e as typeof e & {
        delta?: number
        driftedSinceMatch?: boolean
      }
      return { ...rest, status: 'matched-equal' as const, ...groupFields }
    }
    return {
      ...e,
      status: 'matched-diff' as const,
      // 행 단위 delta 는 더 이상 의미가 없다 — delta 를 읽는 기존 UI/집계가 그룹 값을 보게 한다.
      delta: groupDelta,
      driftedSinceMatch: anyDrift.get(key) ? true : undefined,
      ...groupFields,
    }
  })
}
