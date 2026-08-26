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

/** AI 추출 상품 정보(설명/특징/인증정보) — 추천 시 문맥 가점·후보 채굴에 쓴다. */
export type ProductContext = {
  description?: string | null
  features?: string[]
  certifications?: string[]
}

export type SuggestKeywordsInput = {
  productName: string
  existing: string[]
  masterPool: SuggestPoolItem[]
  rules: KeywordRuleSet
  productContext?: ProductContext
}

export type SuggestKeywordOrigin = 'pool' | 'context'

export type SuggestKeywordDetail = {
  keyword: string
  origin: SuggestKeywordOrigin
}

/** 문맥 일치 시 정렬용 점수에 더하는 가점. 필터가 아니라 부스트다. */
export const CONTEXT_BOOST = 15

/**
 * 인증정보 문자열에서 검색어로 쓸 수 있는 "유형어"만 뽑는 화이트리스트.
 * 인증번호(예: CB072R0012-24001)는 검색어가 아니므로 절대 그대로 노출하지 않는다.
 */
export const CERTIFICATION_TYPE_WHITELIST = [
  'KC',
  '식약처',
  '해썹',
  'HACCP',
  '유기농',
  '친환경',
  'KS',
  '안전확인',
  '전기용품',
  '의료기기',
] as const

// features 채굴 시 걸러낼 한국어 불용어 — 목록은 최소한만 유지한다.
export const KEYWORD_MINING_STOPWORDS = new Set([
  '그리고',
  '또는',
  '있는',
  '있음',
  '없음',
  '이용',
  '사용',
  '제공',
  '가능',
  '으로',
  '에서',
  '입니다',
])

const MIN_MINED_TOKEN_LENGTH = 2
const MAX_MINED_TOKEN_LENGTH = 10

/** description + features 를 정규화해 부분 일치 검사에 쓸 문맥 문자열로 합친다. */
function buildContextText(context: ProductContext | undefined): string {
  if (!context) return ''
  const parts: string[] = []
  if (context.description) parts.push(context.description)
  if (Array.isArray(context.features)) parts.push(...context.features)
  return normalizeKeyword(parts.join(' '))
}

/** certifications 문자열 배열에서 화이트리스트 유형어만 추려 문맥에 더한다. */
function extractCertificationTerms(certifications: string[] | undefined): string[] {
  if (!Array.isArray(certifications)) return []
  const found = new Set<string>()
  for (const raw of certifications) {
    const text = String(raw ?? '')
    for (const term of CERTIFICATION_TYPE_WHITELIST) {
      if (text.toUpperCase().includes(term.toUpperCase())) found.add(term)
    }
  }
  return Array.from(found)
}

/** features 를 2~10자 토큰으로 쪼개 후보 채굴용 원시 토큰 목록을 만든다. */
function mineFeatureTokens(features: string[] | undefined): string[] {
  if (!Array.isArray(features)) return []
  const tokens: string[] = []
  for (const feature of features) {
    for (const raw of String(feature ?? '').split(/[\s,.\/·|]+/)) {
      const token = raw.trim()
      if (token.length < MIN_MINED_TOKEN_LENGTH || token.length > MAX_MINED_TOKEN_LENGTH) continue
      if (KEYWORD_MINING_STOPWORDS.has(token)) continue
      tokens.push(token)
    }
  }
  return tokens
}

/**
 * 추천 검색어 상세 목록(문맥 반영).
 * - §10 상품명과 중복되는 표현 제외
 * - 이미 등록된(existing) 표현 제외
 * - status 가 BANNED/EXCLUDED 인 항목 제외
 * - productContext 가 있으면 설명·특징·인증정보와 일치하는 항목에 CONTEXT_BOOST 가점
 *   (필터가 아니라 정렬 부스트 — 문맥과 무관해도 배제되지 않는다)
 * - 정렬: (score + 문맥가점) 내림차순 → §18 우선순위 오름차순
 * - 풀만으로 슬롯이 안 채워지면 features 에서 후보를 채굴해 뒤에 덧붙인다
 * - 남은 슬롯(maxKeywords - existing) 만큼만 돌려준다
 *
 * masterPool 이 비고 productContext 도 없으면 빈 배열 (Phase 2 이전의 정상 상태).
 */
export function suggestKeywordsDetailed(input: SuggestKeywordsInput): SuggestKeywordDetail[] {
  const taken = new Set(input.existing.map((k) => normalizeKeyword(k)).filter(Boolean))

  const certTerms = extractCertificationTerms(input.productContext?.certifications)
  const contextText = [buildContextText(input.productContext), ...certTerms]
    .filter(Boolean)
    .join(' ')
    .trim()

  const picked: (SuggestPoolItem & { boostedScore: number })[] = []
  const seen = new Set<string>()
  for (const item of input.masterPool) {
    const keyword = String(item?.keyword ?? '').trim()
    if (!keyword) continue
    if (item.status === 'BANNED' || item.status === 'EXCLUDED') continue
    const key = normalizeKeyword(keyword)
    if (taken.has(key) || seen.has(key)) continue
    if (overlapsProductName(keyword, input.productName)) continue
    seen.add(key)
    const inContext = contextText.length > 0 && contextText.includes(key)
    picked.push({ ...item, keyword, boostedScore: item.score + (inContext ? CONTEXT_BOOST : 0) })
  }

  picked.sort((a, b) => {
    if (b.boostedScore !== a.boostedScore) return b.boostedScore - a.boostedScore
    return keywordPriority(a.type) - keywordPriority(b.type)
  })

  const slots = Math.max(0, input.rules.maxKeywords - taken.size)
  const poolResult: SuggestKeywordDetail[] = picked
    .slice(0, slots)
    .map((x) => ({ keyword: x.keyword, origin: 'pool' as const }))

  if (poolResult.length >= slots) return poolResult

  // 풀만으로는 부족 — features 를 채굴해 나머지 슬롯을 채운다(설명 프로즈는 노이즈가 많아 제외).
  const usedKeys = new Set([...taken, ...poolResult.map((x) => normalizeKeyword(x.keyword))])
  const mined: SuggestKeywordDetail[] = []
  for (const token of mineFeatureTokens(input.productContext?.features)) {
    if (mined.length + poolResult.length >= slots) break
    const key = normalizeKeyword(token)
    if (usedKeys.has(key)) continue
    if (overlapsProductName(token, input.productName)) continue
    usedKeys.add(key)
    mined.push({ keyword: token, origin: 'context' })
  }

  return [...poolResult, ...mined]
}

/** 하위 호환용 — 키워드 문자열만 필요한 기존 호출부는 이 함수를 그대로 쓴다. */
export function suggestKeywords(input: SuggestKeywordsInput): string[] {
  return suggestKeywordsDetailed(input).map((x) => x.keyword)
}
