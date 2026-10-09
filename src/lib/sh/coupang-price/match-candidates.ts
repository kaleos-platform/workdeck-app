import { signatureOf, type ListingSignature } from './listing-derive'

export type MatchStatus =
  | 'CONFIRMED'
  | 'NEEDS_REVIEW'
  | 'CANDIDATE'
  | 'AMBIGUOUS'
  | 'NONE'
  | 'EXCLUDED'

export type MatchResult = {
  status: MatchStatus
  candidateListingIds: string[]
  /** 같은 리스팅을 유일 후보로 노리는 다른 미연결 항목·그 리스팅에 이미 연결된 항목 */
  conflictItemIds: string[]
}

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
  /** excluded = 매칭 안 함. 상태는 EXCLUDED 이고 다른 항목의 경쟁자로 세지 않는다. */
  items: Array<{
    id: string
    rgVendorItemId: string | null
    listingId: string | null
    excluded?: boolean
  }>
  skuByVendorItemId: Map<string, string>
  compositionBySku: Map<string, ListingSignature[]>
  listings: Array<{ id: string; items: ListingSignature[] }>
}): Map<string, MatchResult> {
  const listingsBySig = new Map<string, string[]>()
  for (const l of args.listings) {
    if (l.items.length === 0) continue
    const sig = signatureOf(l.items)
    listingsBySig.set(sig, [...(listingsBySig.get(sig) ?? []), l.id])
  }

  const out = new Map<string, MatchResult>()
  for (const item of args.items) {
    const sku = item.rgVendorItemId ? args.skuByVendorItemId.get(item.rgVendorItemId) : undefined
    const composition = sku ? args.compositionBySku.get(sku) : undefined
    const candidates = composition
      ? [...(listingsBySig.get(signatureOf(composition)) ?? [])].sort()
      : []

    let status: MatchStatus
    if (item.excluded) status = 'EXCLUDED'
    else if (item.listingId) {
      status =
        candidates.length === 1 && candidates[0] !== item.listingId ? 'NEEDS_REVIEW' : 'CONFIRMED'
    } else if (candidates.length === 1) status = 'CANDIDATE'
    else if (candidates.length > 1) status = 'AMBIGUOUS'
    else status = 'NONE'

    out.set(item.id, { status, candidateListingIds: candidates, conflictItemIds: [] })
  }

  // 일괄 확정이 엉뚱한 옵션을 잇지 않게 — 같은 리스팅을 유일 후보로 가진 미연결 옵션이 둘 이상이거나
  // (여러 RG SKU 가 같은 구성에 매핑), 그 리스팅이 이미 다른 옵션에 연결돼 있으면 사람이 골라야 한다.
  const claimants = new Map<string, string[]>()
  for (const [id, r] of out) {
    if (r.status === 'CANDIDATE') {
      const l = r.candidateListingIds[0]
      claimants.set(l, [...(claimants.get(l) ?? []), id])
    }
  }
  const linkedBy = new Map<string, string>()
  for (const i of args.items) if (i.listingId && !i.excluded) linkedBy.set(i.listingId, i.id)
  for (const [id, r] of out) {
    if (r.status !== 'CANDIDATE') continue
    const l = r.candidateListingIds[0]
    const others = (claimants.get(l) ?? []).filter((o) => o !== id)
    const owner = linkedBy.get(l)
    if (owner) others.push(owner)
    if (others.length > 0) {
      r.status = 'AMBIGUOUS'
      r.conflictItemIds = others
    }
  }
  return out
}
