/**
 * 가격그룹 → 쿠팡 채널 리스팅 유도.
 *
 * 시뮬의 가격그룹은 optionIds[](같은 가격의 옵션 묶음) + quantity 를 갖고,
 * 리스팅은 ProductListingItem(optionId, quantity) 를 갖는다.
 * 구성 시그니처가 같으면 같은 판매 단위다.
 *
 * 이름 매칭은 쓰지 않는다 — ChannelProductAlias 가 같은 발상으로 매칭률 0 이었다.
 */
export type ListingSignature = { optionId: string; quantity: number }

export function signatureOf(items: ListingSignature[]): string {
  return items
    .map((i) => `${i.optionId}x${i.quantity}`)
    .sort()
    .join(',')
}

export function deriveListings(
  group: { optionIds: string[]; quantity: number },
  listings: Array<{ id: string; items: ListingSignature[] }>
): { matched: string[]; ambiguous: string[][] } {
  // 그룹의 각 옵션은 "그 옵션 × quantity" 단일 구성 리스팅에 대응한다.
  const wanted = new Map<string, string>() // signature -> optionId
  for (const optionId of group.optionIds) {
    wanted.set(signatureOf([{ optionId, quantity: group.quantity }]), optionId)
  }

  const bySig = new Map<string, string[]>()
  for (const l of listings) {
    const sig = signatureOf(l.items)
    if (!wanted.has(sig)) continue
    const arr = bySig.get(sig) ?? []
    arr.push(l.id)
    bySig.set(sig, arr)
  }

  const matched: string[] = []
  const ambiguous: string[][] = []
  for (const ids of bySig.values()) {
    if (ids.length === 1) matched.push(ids[0])
    else ambiguous.push([...ids].sort())
  }
  return { matched: matched.sort(), ambiguous }
}
