// 검색어 후보 평가 — 가이드 §17 점수표, §18 우선순위.

/**
 * §13 검색어 후보 분류 체계. Prisma enum 은 Phase 2 에서 도입하므로 지금은 문자열 유니온.
 */
export type KeywordTypeKey =
  | 'SYNONYM'
  | 'PARENT_CATEGORY'
  | 'MATERIAL'
  | 'SHAPE'
  | 'PURPOSE'
  | 'FEATURE'
  | 'ALIAS'
  | 'COMPETITOR'
  | 'UNCLASSIFIED'

export type KeywordScoreInputs = {
  /** 상품과 정확히 일치 +3 */
  exactMatch: boolean
  /** 명확한 구매 의도 +3 */
  purchaseIntent: boolean
  /** 쿠팡 자동완성 등장 +2 */
  inAutocomplete: boolean
  /** 연관검색어 등장 +2 */
  inRelated: boolean
  /** 고객 리뷰 반복 +1 */
  inReviews: boolean
  /** 상품명과 중복 -2 */
  overlapsProductName: boolean
  /** 카테고리와 단순 중복 -1 */
  overlapsCategory: boolean
  /** 상품과 부분적으로만 관련 -2 */
  partialRelevanceOnly: boolean
  /** 경쟁 브랜드 — 제외(하드) */
  isCompetitorBrand: boolean
  /** 사실과 다른 표현 — 제외(하드) */
  isFalseClaim: boolean
}

export type KeywordDecision = 'USE' | 'CANDIDATE' | 'EXCLUDE' | 'BANNED'

export type KeywordScoreResult = {
  score: number
  decision: KeywordDecision
  /** 한국어. 배지 툴팁에 그대로 렌더한다. */
  reasons: string[]
}

const USE_THRESHOLD = 8
const CANDIDATE_THRESHOLD = 4

/**
 * §17 평가. **합계 임계값만으로 판정하지 않는다.**
 * 가이드 표에서 '호텔 타월'은 3+3+2-2=6점인데도 상품명에 있다는 이유로 제외되고,
 * 경쟁 브랜드·허위 표현은 0점이 아니라 즉시 배제다. 그래서 캐스케이드로 먼저 거른 뒤
 * 남은 후보만 점수 구간으로 나눈다.
 */
export function scoreKeyword(i: KeywordScoreInputs): KeywordScoreResult {
  const reasons: string[] = []
  let score = 0

  if (i.exactMatch) {
    score += 3
    reasons.push('상품과 정확히 일치 +3')
  }
  if (i.purchaseIntent) {
    score += 3
    reasons.push('명확한 구매 의도 +3')
  }
  if (i.inAutocomplete) {
    score += 2
    reasons.push('쿠팡 자동완성 등장 +2')
  }
  if (i.inRelated) {
    score += 2
    reasons.push('연관검색어 등장 +2')
  }
  if (i.inReviews) {
    score += 1
    reasons.push('고객 리뷰에서 반복 +1')
  }
  if (i.overlapsProductName) {
    score -= 2
    reasons.push('상품명과 중복 -2')
  }
  if (i.overlapsCategory) {
    score -= 1
    reasons.push('카테고리와 단순 중복 -1')
  }
  if (i.partialRelevanceOnly) {
    score -= 2
    reasons.push('상품과 부분적으로만 관련 -2')
  }

  // 1. 하드 배제 — 점수와 무관 (§17 '제외', §19)
  if (i.isCompetitorBrand || i.isFalseClaim) {
    reasons.push(i.isCompetitorBrand ? '경쟁 브랜드 — 사용 금지' : '사실과 다른 표현 — 사용 금지')
    return { score, decision: 'BANNED', reasons }
  }

  // 2. 상품명 중복 (§10 Rule 1) — 6점이어도 제외되는 '호텔 타월' 케이스
  if (i.overlapsProductName) {
    reasons.push('상품명에 이미 있으므로 제외')
    return { score, decision: 'EXCLUDE', reasons }
  }

  // 3. 관련성 전무 (§17 '극세사 수건') — 정확히 일치하지도, 부분적으로 관련되지도 않음
  if (!i.exactMatch && !i.partialRelevanceOnly) {
    reasons.push('상품과 관련성이 확인되지 않아 제외')
    return { score, decision: 'EXCLUDE', reasons }
  }

  if (score >= USE_THRESHOLD) return { score, decision: 'USE', reasons }
  if (score >= CANDIDATE_THRESHOLD) return { score, decision: 'CANDIDATE', reasons }
  reasons.push('점수가 낮아 제외')
  return { score, decision: 'EXCLUDE', reasons }
}

// §18 검색어 우선순위 (숫자가 작을수록 먼저)
const PRIORITY: Record<KeywordTypeKey, number> = {
  SYNONYM: 1, // 1순위: 상품과 정확히 일치하는 다른 검색 표현
  PURPOSE: 2, // 2순위: 구매 의도가 높은 용도
  MATERIAL: 3, // 3순위: 소재/형태/특징
  SHAPE: 3,
  FEATURE: 3,
  PARENT_CATEGORY: 4, // 4순위: 상위 개념
  ALIAS: 5, // 5순위: 별칭/영문명
  COMPETITOR: 99, // 등록 대상이 아님
  UNCLASSIFIED: 9,
}

export function keywordPriority(type: KeywordTypeKey): number {
  return PRIORITY[type] ?? 9
}
