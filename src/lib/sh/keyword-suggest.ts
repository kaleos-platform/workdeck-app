// 검색어 추천 — 키워드 마스터 풀(§24)에서 이 상품에 넣을 만한 후보를 골라준다.

import { normalizeKeyword } from './keyword-normalize'
import { keywordPriority, type KeywordTypeKey } from './keyword-score'
import type { KeywordRuleSet } from './keyword-rules'
import { overlapsProductName } from './keyword-validate'

/** §24 Keyword Master 의 Status 표준값 */
export type SuggestPoolStatus =
  | 'PRODUCT_NAME'
  | 'SEARCH_TERM'
  | 'SEARCH_OPTION'
  | 'CANDIDATE'
  | 'EXCLUDED'
  | 'BANNED'

export type SuggestPoolItem = {
  keyword: string
  type: KeywordTypeKey
  score: number
  status: SuggestPoolStatus
}

export type SuggestKeywordsInput = {
  productName: string
  existing: string[]
  masterPool: SuggestPoolItem[]
  rules: KeywordRuleSet
}

/**
 * 추천 검색어 목록.
 * - §10 상품명과 중복되는 표현 제외
 * - 이미 등록된(existing) 표현 제외
 * - status 가 BANNED/EXCLUDED 인 항목 제외
 * - 정렬: score 내림차순 → §18 우선순위 오름차순
 * - 남은 슬롯(maxKeywords - existing) 만큼만 돌려준다
 *
 * masterPool 이 비면 빈 배열 (Phase 2 에서 풀을 주입하기 전까지의 정상 상태).
 */
export function suggestKeywords(input: SuggestKeywordsInput): string[] {
  const taken = new Set(input.existing.map((k) => normalizeKeyword(k)).filter(Boolean))

  const picked: SuggestPoolItem[] = []
  const seen = new Set<string>()
  for (const item of input.masterPool) {
    const keyword = String(item?.keyword ?? '').trim()
    if (!keyword) continue
    if (item.status === 'BANNED' || item.status === 'EXCLUDED') continue
    const key = normalizeKeyword(keyword)
    if (taken.has(key) || seen.has(key)) continue
    if (overlapsProductName(keyword, input.productName)) continue
    seen.add(key)
    picked.push({ ...item, keyword })
  }

  picked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return keywordPriority(a.type) - keywordPriority(b.type)
  })

  const slots = Math.max(0, input.rules.maxKeywords - taken.size)
  return picked.slice(0, slots).map((x) => x.keyword)
}
