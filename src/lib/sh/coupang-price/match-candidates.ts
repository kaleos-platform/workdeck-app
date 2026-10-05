import { signatureOf, type ListingSignature } from './listing-derive'

export type MatchStatus = 'CONFIRMED' | 'NEEDS_REVIEW' | 'CANDIDATE' | 'AMBIGUOUS' | 'NONE'

/**
 * 쿠팡 옵션 → 워크덱 리스팅 자동 후보.
 *
 *   rgVendorItemId(=재고 optionId) → skuId → 로켓그로스 재고 매핑 구성 → 같은 구성 리스팅
 *
 * 재고 매핑은 재고 대조용으로 사람이 확정한 값이라 신뢰할 수 있다. RG 축이 없는
 * 판매자배송 전용 옵션은 이 경로가 없어 수동이다. 확정된 매칭(listingId)은 절대 덮지 않고,
 * 후보가 다른 리스팅을 가리키면 확인 필요로만 표시한다(재고 매핑·리스팅 구성 변경 신호).
 * 상태는 저장하지 않고 조회 시 계산한다 — 저장하면 매핑 변경마다 무효화가 필요하다.
 */
export function computeMatchCandidates(args: {
  items: Array<{ id: string; rgVendorItemId: string | null; listingId: string | null }>
  skuByVendorItemId: Map<string, string>
  compositionBySku: Map<string, ListingSignature[]>
  listings: Array<{ id: string; items: ListingSignature[] }>
}): Map<string, { status: MatchStatus; candidateListingIds: string[] }> {
  const listingsBySig = new Map<string, string[]>()
  for (const l of args.listings) {
    if (l.items.length === 0) continue
    const sig = signatureOf(l.items)
    listingsBySig.set(sig, [...(listingsBySig.get(sig) ?? []), l.id])
  }

  const out = new Map<string, { status: MatchStatus; candidateListingIds: string[] }>()
  for (const item of args.items) {
    const sku = item.rgVendorItemId ? args.skuByVendorItemId.get(item.rgVendorItemId) : undefined
    const composition = sku ? args.compositionBySku.get(sku) : undefined
    const candidates = composition ? [...(listingsBySig.get(signatureOf(composition)) ?? [])].sort() : []

    let status: MatchStatus
    if (item.listingId) {
      status =
        candidates.length === 1 && candidates[0] !== item.listingId ? 'NEEDS_REVIEW' : 'CONFIRMED'
    } else if (candidates.length === 1) status = 'CANDIDATE'
    else if (candidates.length > 1) status = 'AMBIGUOUS'
    else status = 'NONE'

    out.set(item.id, { status, candidateListingIds: candidates })
  }
  return out
}
