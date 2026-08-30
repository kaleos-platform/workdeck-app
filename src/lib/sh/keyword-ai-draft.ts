/**
 * seller-hub 키워드 개편 Phase 5 — AI 상품명·검색어 초안 생성 + 등록 검색어 진단.
 *
 * `docs/decks/seller-hub/guides/쿠팡 상품명 및 검색어 운영 가이드.md` 기준으로
 *   ① 상품명 후보 3개
 *   ② 검색어 후보 (과생성 — 호출부가 결정적 규칙으로 걸러 상위 N개만 쓴다)
 *   ③ 이미 등록된 검색어에 대한 판정
 * 를 **한 번의 호출**로 만든다.
 *
 * 공급자: 재무 추천(src/lib/finance/ai-suggest.ts)과 동일하게 Gemini API(@google/genai)를 직접
 * 호출한다(공유 텍스트 체인 generateTextWithFallback[codex/gemini-cli/ollama]은 건드리지 않음 —
 * seller-hub 도 재무처럼 분리). 키 = GEMINI_API_KEY 우선, 없으면 GOOGLE_AI_API_KEY 폴백.
 * 모델 = AI_PRIMARY_MODEL(기본 gemini-2.5-flash). 키 미설정/오류/파싱 실패면 null. 결코 throw 안 함.
 *
 * 초안은 여기서 검증하지 않는다 — 후보를 그대로 반환하고, 호출부(API 라우트)가
 * keyword-draft-filter.ts 의 결정적 검증기로 위반 후보를 버리고 진단을 조립한다.
 *
 * ⚠️ 프롬프트는 **블록 단위로 재작성**한다. 규칙 줄을 아래에 덧붙이는 방식으로 패치하면
 * 상위 지시와 충돌해 출력 품질이 무너진다(상품 소재 AI 추출 4·5차에서 같은 함정을 두 번 밟음).
 */
import { GoogleGenAI } from '@google/genai'

import {
  KEYWORD_INTENT_LABELS,
  type KeywordIntent,
  type KeywordReviewLabel,
} from './keyword-labels'

const DEFAULT_MODEL = 'gemini-2.5-flash'

/**
 * 검색어 과생성 개수 — 결정적 필터에서 절반 가까이 떨어져도 target 을 채울 수 있는 여유.
 * 상품명 복합어 판정(KW_NAME_COMPOUND)이 들어오면서 드롭률이 올라 24 → 30 으로 올렸다.
 * filterDraftKeywords 는 의도적으로 백필하지 않으므로 여유가 모자라면 그대로 10개 미만이 된다.
 * 실제 드롭률은 TextGenerationLog 의 generated/kept 로 관측한다.
 */
export const KEYWORD_OVERGENERATE = 30
/** 필터 통과 후 실제로 내려보내는 검색어 수. */
export const KEYWORD_TARGET = 10
/**
 * 진단 대상 등록 검색어 상한. 프롬프트 입력이자 출력(reviews) 길이라 응답 토큰을 직접 좌우한다 —
 * 상한이 없으면 링크가 수십 개인 상품에서 JSON 이 잘리고, 그러면 상품명 후보까지 통째로 날아간다.
 */
export const REVIEW_LIMIT = 25

const INTENT_VALUES = Object.keys(KEYWORD_INTENT_LABELS) as KeywordIntent[]
const INTENT_SET = new Set<string>(INTENT_VALUES)

const REVIEW_LABEL_SET = new Set<string>([
  'KEEP',
  'LOW_RELEVANCE',
  'COMPETITOR_BRAND',
  'FALSE_CLAIM',
  'CATEGORY_STUFFING',
  'LOW_INTENT',
  'MOVE_TO_OPTION',
] satisfies KeywordReviewLabel[])

export type AdTermHint = { keyword: string; clicks: number; orders: number }

export type NameDraftInput = {
  brandName: string | null
  productName: string // 관리 상품명 등 기준 이름
  categoryName: string | null
  description: string | null
  features: string[]
  certifications: string[]
  optionSummary: string[] // 옵션 속성 요약(예: '색상: 블랙/화이트')
  existingKeywords: string[] // 이미 등록된 검색어 — 중복 제안 방지 + 진단 대상
  adTerms: AdTermHint[] // 광고 리포트 실검색어 — 비면 섹션 자체를 생략한다
  keywordPool: string[] // 같은 space 의 KeywordMaster 후보 풀 — 참고용
  channelName: string
  nameTargetMin: number
  nameTargetMax: number
}

export type DraftKeyword = { keyword: string; intent: KeywordIntent; reason: string }
export type DraftReview = { keyword: string; label: KeywordReviewLabel; reason: string }

export type NameDraftResult = {
  names: string[]
  keywords: DraftKeyword[]
  reviews: DraftReview[]
}

/** system 프롬프트 — 통째로 하나의 블록이다. 줄 단위로 덧붙이지 말고 이 상수를 다시 쓸 것. */
function buildSystemPrompt(input: NameDraftInput): string {
  return `당신은 한국 쿠팡 셀러의 상품명·검색어(SEO)를 설계하는 전문가입니다.
"쿠팡 상품명 및 검색어 운영 가이드"를 따라 아래 세 가지를 한 번에 만듭니다.

# 1. 상품명 후보 (names) — 3개
- 목표 글자 수 ${input.nameTargetMin}~${input.nameTargetMax}자.
- 같은 단어를 상품명 안에서 반복하지 않습니다.
- 금지: 무료배송·특가·최저가·세일·1+1 등 프로모션/배송 표현, 판매자명(스토어명),
  ★☆♥ 등 장식용 특수문자, 경쟁 브랜드명, 효능·효과를 단정하는 표현.

# 2. 검색어 후보 (keywords) — 정확히 ${KEYWORD_OVERGENERATE}개
검색어는 상품명을 보완하는 "다른 진입로"입니다. 상품명에 이미 있는 단어를 다시 넣으면
아무 효과가 없습니다(가이드에서 가장 중요한 규칙).

다음 6개 축을 **모두** 사용해 골고루 만듭니다. 한 축에 몰지 마세요.
- PURPOSE(용도)    : 이 상품을 무엇에 쓰는가              예) 캠핑 조리, 자취 요리
- TARGET(대상)     : 누가 쓰는가                          예) 신혼부부, 초보캠퍼
- SITUATION(상황)  : 언제·어디서 쓰는가                   예) 집들이선물, 야외백패킹
- ATTRIBUTE(속성)  : 상품명에 없는 재질·형태·규격         예) 통주물, 논스틱
- PROBLEM(문제해결): 어떤 불편을 없애는가                 예) 눌러붙음방지, 기름튐방지
- LONGTAIL(롱테일) : 2~3단어 구체 조합, 경쟁이 낮은 것    예) 1인용 미니 무쇠팬

지켜야 할 것:
- **기준 상품명에 들어 있는 단어는 검색어에 붙이지 않습니다.** 상품명 단어는 이미 검색에
  잡히므로 뒤에 붙여봐야 새 유입이 없습니다. 기준 상품명이 "쿨 메쉬 심리스 커버 브라
  노와이어 중년 여성 속옷"이라면 '브라'·'여성'·'속옷' 을 붙인 검색어는 전부 금지입니다.
  나쁨: '여름브라', '풀컵브라', '갱년기브라', '50대여성브라', '노와이어브라'
  좋음: '여름', '풀컵', '갱년기', '50대', '군살보정', '무봉제', '흡습속건'
  즉 **상품명 단어를 뺀 나머지만** 검색어로 씁니다. 짧아 보여도 그게 맞습니다.
- [이미 등록된 검색어]와 같거나, 띄어쓰기만 다르거나, 단어 순서만 바꾼 것을 내지 않습니다.
- 후보끼리도 서로 띄어쓰기 변형·순서 변형이 되지 않게 합니다.
- 검색어 1개는 25자 이내, 의미 단위 1개로 만듭니다.
- 배송 표현, 효능·효과 표현, 경쟁 브랜드는 쓰지 않습니다.
- 카테고리명 그대로, 구매옵션(색상/사이즈/수량) 그대로인 단어는 검색어가 아닙니다.
- **구매 의도가 높은 것부터 순서대로 나열합니다.** 앞쪽 ${KEYWORD_TARGET}개만 실제로 쓰입니다.
- reason 은 40자 이내 한국어 한 문장.

# 3. 등록된 검색어 진단 (reviews)
[이미 등록된 검색어] 각각을 판정합니다. 최대 ${REVIEW_LIMIT}개.

**기본값은 KEEP 입니다.** 대부분의 등록 검색어는 문제가 없습니다. 이 상품을 찾는 사람이
실제로 검색할 만한 말이면 전부 KEEP 입니다 — 표현이 촌스럽거나, 겹치는 느낌이 들거나,
더 좋은 대안이 떠오른다는 이유로 지적하지 마세요. 아래 일곱 가지 중 **명확히 해당하는
것만** 골라내고, 애매하면 KEEP 입니다.

- KEEP              : 위 기준. 유지한다.
- LOW_RELEVANCE     : **다른 상품군**을 찾는 검색어다. 이 검색어로 들어온 사람이 이 상품을
                      보면 "내가 찾던 게 아니다"라고 느낀다. 같은 상품군의 다른 표현·별칭·
                      하위 유형은 해당하지 않는다.
- COMPETITOR_BRAND  : 다른 회사의 브랜드명이다.
- FALSE_CLAIM       : 이 상품에 **없는** 기능·효능을 말한다. 상품 정보에 근거가 없어야 한다.
- CATEGORY_STUFFING : 카테고리명 하나를 그대로 옮겨 적었을 뿐이다.
- LOW_INTENT        : 사는 게 아니라 알아보려는 검색어다(사용법·후기·비교 등).
- MOVE_TO_OPTION    : 색상·사이즈처럼 검색어가 아니라 "검색 옵션"으로 관리할 값이다.

상품명 단어를 다시 쓴 검색어는 **여기서 지적하지 마세요** — 규칙 검사가 따로 판정해
사용자에게 이미 보여주고 있습니다. 같은 것을 두 번 지적하면 목록이 경고로 덮여 진짜
문제가 묻힙니다.

reason 은 40자 이내. KEEP 이면 왜 남길 만한지 짧게 씁니다.

# 출력 형식
순수 JSON 만 반환합니다(마크다운·코드블록·설명 금지).
{
  "names": ["상품명 후보1", "상품명 후보2", "상품명 후보3"],
  "keywords": [{"keyword": "검색어", "intent": "PURPOSE", "reason": "사유"}],
  "reviews": [{"keyword": "등록된 검색어", "label": "KEEP", "reason": "사유"}]
}`
}

/** user 컨텍스트 — 값이 없는 섹션은 줄 자체를 넣지 않는다. */
function buildUserPrompt(input: NameDraftInput): string {
  const lines: string[] = [`[판매채널] ${input.channelName}`, `[기준 상품명] ${input.productName}`]
  if (input.brandName) lines.push(`[브랜드] ${input.brandName}`)
  if (input.categoryName) lines.push(`[카테고리] ${input.categoryName}`)
  if (input.description) lines.push(`[상세 설명] ${input.description}`)
  if (input.features.length > 0) lines.push(`[특징] ${input.features.join(', ')}`)
  if (input.certifications.length > 0) lines.push(`[인증] ${input.certifications.join(', ')}`)
  if (input.optionSummary.length > 0) lines.push(`[옵션] ${input.optionSummary.join(' / ')}`)
  if (input.existingKeywords.length > 0) {
    lines.push(
      `[이미 등록된 검색어 — 중복 제안 금지, 진단 대상] ${input.existingKeywords.join(', ')}`
    )
  }
  if (input.adTerms.length > 0) {
    // 자동완성·연관검색어를 대신하는 실측 근거. 쿠팡 자동수집은 봇 차단으로 보류됐으므로
    // 우리가 확보한 광고 리포트 유입 검색어를 대신 쓴다.
    const terms = input.adTerms
      .map((t) => `${t.keyword} (클릭 ${t.clicks}, 주문 ${t.orders})`)
      .join(' / ')
    lines.push(`[실제 유입된 검색어 — 광고 리포트 기준, 클릭 많은 순] ${terms}`)
  }
  if (input.keywordPool.length > 0) {
    lines.push(`[우리 공간의 기존 검색어 풀 — 참고용] ${input.keywordPool.join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * 상품 문맥을 바탕으로 상품명·검색어 초안과 등록 검색어 진단을 Gemini 로 생성한다.
 * 적합한 응답을 받지 못하면(키 미설정/API 오류/JSON 파싱 실패/빈 결과) null. 결코 throw 하지 않는다.
 */
export async function draftProductNames(input: NameDraftInput): Promise<NameDraftResult | null> {
  const content = await callGemini(buildSystemPrompt(input), buildUserPrompt(input))
  if (!content) return null

  return parseDraft(content)
}

/** Gemini API(@google/genai) 단발 호출 — seller-hub 초안 전용. 키 미설정/오류면 null. */
async function callGemini(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY
  if (!apiKey) return null
  try {
    const ai = new GoogleGenAI({ apiKey })
    const res = await ai.models.generateContent({
      model: process.env.AI_PRIMARY_MODEL ?? DEFAULT_MODEL,
      contents: user,
      config: {
        systemInstruction: system,
        temperature: 0.4,
        // 후보 24 + 진단 25 + 이름 3 을 담아야 한다. 상한일 뿐 미사용분은 과금되지 않으므로
        // 넉넉히 잡는다 — 잘리면 parseDraft 가 null 을 돌려주고 상품명 기능까지 같이 죽는다.
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        // thinking 활성 시 maxOutputTokens 를 thinking 토큰이 다 먹어 JSON 이 잘린 채
        // MAX_TOKENS 로 끊긴다(재무 ai-suggest.ts 와 동일 이유로 비활성).
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
    const text = res.text
    return text && text.trim() ? text : null
  } catch {
    return null
  }
}

/** Prisma Json? 필드와 동일한 방어 — 배열이 아니거나 원소가 문자열이 아니면 걸러낸다. */
function toStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string') continue
    const trimmed = v.trim()
    if (!trimmed) continue
    out.push(trimmed)
    if (out.length >= limit) break
  }
  return out
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** keywords: [{keyword, intent, reason}] — intent 가 규격 밖이면 버리지 않고 ATTRIBUTE 로 떨어뜨린다. */
function toKeywordList(value: unknown, limit: number): DraftKeyword[] {
  if (!Array.isArray(value)) return []
  const out: DraftKeyword[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { keyword?: unknown; intent?: unknown; reason?: unknown }
    const keyword = asString(e.keyword)
    if (!keyword) continue
    const rawIntent = asString(e.intent).toUpperCase()
    out.push({
      keyword,
      intent: INTENT_SET.has(rawIntent) ? (rawIntent as KeywordIntent) : 'ATTRIBUTE',
      reason: asString(e.reason),
    })
    if (out.length >= limit) break
  }
  return out
}

/** reviews: [{keyword, label, reason}] — 라벨이 규격 밖이면 그 판정은 버린다(잘못된 제거 권고 방지). */
function toReviewList(value: unknown, limit: number): DraftReview[] {
  if (!Array.isArray(value)) return []
  const out: DraftReview[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { keyword?: unknown; label?: unknown; reason?: unknown }
    const keyword = asString(e.keyword)
    const label = asString(e.label).toUpperCase()
    if (!keyword || !REVIEW_LABEL_SET.has(label)) continue
    out.push({ keyword, label: label as KeywordReviewLabel, reason: asString(e.reason) })
    if (out.length >= limit) break
  }
  return out
}

/** 모델 응답에서 첫 { … 마지막 } 구간을 JSON 파싱(코드블록/주변 텍스트 방어). */
export function parseDraft(raw: string): NameDraftResult | null {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      names?: unknown
      keywords?: unknown
      reviews?: unknown
    }
    const names = toStringList(obj.names, 3)
    // 과생성분을 여기서 자르면 필터가 쓸 여유분이 사라진다 — 상한은 요청 개수보다 넉넉하게.
    const keywords = toKeywordList(obj.keywords, KEYWORD_OVERGENERATE + 6)
    const reviews = toReviewList(obj.reviews, REVIEW_LIMIT)
    if (names.length === 0 && keywords.length === 0) return null
    return { names, keywords, reviews }
  } catch {
    return null
  }
}

export { buildSystemPrompt, buildUserPrompt }
