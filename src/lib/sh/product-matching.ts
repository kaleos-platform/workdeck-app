/**
 * 배송 주문의 원본 상품 문자열 ↔ 카탈로그 매칭 유틸.
 *
 * 매칭 대상은 "판매채널 상품(ProductListing)" 또는 "단일 옵션(InvProductOption)"이다.
 * ChannelProductAlias가 두 개 중 하나를 가리키고, 우선순위는 listingId > optionId.
 * 단순 정규화 정확 일치만 지원 (퍼지 매칭은 후속).
 */

export type MatchTarget = {
  listingId?: string | null
  optionId?: string | null
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
}

/**
 * 채널별 별칭 사전을 "정규화 alias → MatchTarget" 맵으로 변환한다.
 * 같은 aliasName에 두 행이 있을 경우 listingId 우선.
 */
export function buildAliasLookup(rows: AliasRow[]): Map<string, MatchTarget> {
  const map = new Map<string, MatchTarget>()
  for (const r of rows) {
    const current = map.get(r.aliasName)
    const incoming: MatchTarget = {
      listingId: r.listingId ?? null,
      optionId: r.optionId ?? null,
    }
    if (!current) {
      map.set(r.aliasName, incoming)
      continue
    }
    // listing이 optionId보다 우선
    if (incoming.listingId && !current.listingId) {
      map.set(r.aliasName, incoming)
    }
  }
  return map
}
