/**
 * 배송 주문의 원본 상품 문자열 ↔ 카탈로그 매칭 유틸.
 *
 * 매칭 대상은 "판매채널 상품(ProductListing)" 또는 "단일 옵션(InvProductOption)"이다.
 * ChannelProductAlias가 두 개 중 하나를 가리키고, 우선순위는 listingId > optionId.
 * 단순 정규화 정확 일치만 지원 (퍼지 매칭은 후속).
 */

export type AliasManualFulfillment = { optionId: string; quantity: number }

export type MatchTarget = {
  listingId?: string | null
  optionId?: string | null
  // 다중 수동 매칭: fulfillments가 있으면 우선 사용 (listingId/optionId 무시)
  fulfillments?: AliasManualFulfillment[] | null
}

/**
 * 원본 상품 문자열을 별칭 key로 정규화한다.
 * - trim
 * - 연속 공백 → 단일 공백
 * - 소문자화
 */
export function normalizeAlias(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

type AliasRow = {
  aliasName: string
  optionId?: string | null
  listingId?: string | null
  fulfillments?: AliasManualFulfillment[] | null
}

/**
 * 채널별 별칭 사전을 "정규화 alias → MatchTarget" 맵으로 변환한다.
 * 우선순위: fulfillments(다중 수동) > listingId > optionId
 */
export function buildAliasLookup(rows: AliasRow[]): Map<string, MatchTarget> {
  const map = new Map<string, MatchTarget>()
  for (const r of rows) {
    const current = map.get(r.aliasName)
    const incoming: MatchTarget = {
      listingId: r.listingId ?? null,
      optionId: r.optionId ?? null,
      fulfillments: r.fulfillments && r.fulfillments.length > 0 ? r.fulfillments : null,
    }
    if (!current) {
      map.set(r.aliasName, incoming)
      continue
    }
    // 우선순위: fulfillments > listing > option
    const incomingPriority = incoming.fulfillments ? 3 : incoming.listingId ? 2 : 1
    const currentPriority = current.fulfillments ? 3 : current.listingId ? 2 : 1
    if (incomingPriority > currentPriority) {
      map.set(r.aliasName, incoming)
    }
  }
  return map
}
