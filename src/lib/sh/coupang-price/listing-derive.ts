/**
 * 가격시뮬 행(rows) → 쿠팡 채널 리스팅 유도.
 *
 * 시뮬 행 = { optionIds(같은 가격의 옵션 묶음), quantity }. 행이 여러 개면 세트다.
 * 리스팅 L 이 대상이려면 L.items 와 rows 사이에 일대일 대응이 있어야 한다 —
 * 각 item 의 optionId 가 대응 행의 optionIds 에 있고 quantity 가 같다.
 * 행 1개면 옵션별 단품 리스팅, 행 N개면 각 행에서 하나씩 고른 조합 세트 리스팅이 된다.
 * item 수가 다르면 절대 매칭되지 않으므로 세트가가 단품에 쓰이는 경로가 구조적으로 닫힌다.
 *
 * 이름 매칭은 쓰지 않는다 — ChannelProductAlias 가 같은 발상으로 매칭률 0 이었다.
 */
export type ListingSignature = { optionId: string; quantity: number }
export type PriceRow = { optionIds: string[]; quantity: number }

export function signatureOf(items: ListingSignature[]): string {
  return items
    .map((i) => `${i.optionId}x${i.quantity}`)
    .sort()
    .join(',')
}

/** items ↔ rows 일대일 대응 존재 여부. 행 수가 작아(실측 수 개) 백트래킹으로 충분하다. */
export function matchesRows(items: ListingSignature[], rows: PriceRow[]): boolean {
  if (items.length === 0 || items.length !== rows.length) return false
  const used = new Array<boolean>(rows.length).fill(false)
  const assign = (i: number): boolean => {
    if (i === items.length) return true
    for (let r = 0; r < rows.length; r++) {
      if (used[r]) continue
      if (rows[r].quantity !== items[i].quantity) continue
      if (!rows[r].optionIds.includes(items[i].optionId)) continue
      used[r] = true
      if (assign(i + 1)) return true
      used[r] = false
    }
    return false
  }
  return assign(0)
}

export function deriveListings(
  rows: PriceRow[],
  listings: Array<{ id: string; items: ListingSignature[] }>
): { matched: string[]; ambiguous: string[][]; unmatched: string[] } {
  if (rows.length === 0) return { matched: [], ambiguous: [], unmatched: [] }

  // 같은 구성(시그니처)의 리스팅이 여러 개면 어느 것인지 사람이 골라야 한다.
  const bySig = new Map<string, string[]>()
  const covered = new Set<string>()
  for (const l of listings) {
    if (!matchesRows(l.items, rows)) continue
    const sig = signatureOf(l.items)
    bySig.set(sig, [...(bySig.get(sig) ?? []), l.id])
    for (const it of l.items) covered.add(it.optionId)
  }

  const matched: string[] = []
  const ambiguous: string[][] = []
  for (const ids of bySig.values()) {
    if (ids.length === 1) matched.push(ids[0])
    else ambiguous.push([...ids].sort())
  }

  // 어느 대상 리스팅에도 등장하지 않는 옵션 — 돌려주지 않으면 반영 대상에서 조용히 빠진다.
  const unmatched = [...new Set(rows.flatMap((r) => r.optionIds))]
    .filter((id) => !covered.has(id))
    .sort()

  return { matched: matched.sort(), ambiguous, unmatched }
}
