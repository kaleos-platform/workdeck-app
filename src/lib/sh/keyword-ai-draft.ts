/**
 * seller-hub 키워드 개편 Phase 5 — AI 상품명·검색어 초안 생성.
 *
 * `docs/쿠팡 상품명 및 검색어 운영 가이드.md` 기준으로 상품명 3개·검색어 10개 내외를 제안한다.
 * 공급자: 재무 추천(src/lib/finance/ai-suggest.ts)과 동일하게 Gemini API(@google/genai)를 직접
 * 호출한다(공유 텍스트 체인 generateTextWithFallback[codex/gemini-cli/ollama]은 건드리지 않음 —
 * seller-hub 도 재무처럼 분리). 키 = GEMINI_API_KEY 우선, 없으면 GOOGLE_AI_API_KEY 폴백.
 * 모델 = AI_PRIMARY_MODEL(기본 gemini-2.5-flash). 키 미설정/오류/파싱 실패면 null. 결코 throw 안 함.
 *
 * 초안은 여기서 검증하지 않는다 — 후보를 그대로 반환하고, 호출부(API 라우트)가
 * keyword-validate.ts 의 결정적 검증기로 위반을 채워 함께 내려준다.
 */
import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODEL = 'gemini-2.5-flash'

export type NameDraftInput = {
  brandName: string | null
  productName: string // 관리 상품명 등 기준 이름
  categoryName: string | null
  description: string | null
  features: string[]
  certifications: string[]
  optionSummary: string[] // 옵션 속성 요약(예: '색상: 블랙/화이트')
  existingKeywords: string[] // 이미 등록된 검색어 — 중복 제안 방지용
  channelName: string
  nameTargetMin: number
  nameTargetMax: number
}

export type NameDraftResult = {
  names: string[]
  keywords: string[]
}

/**
 * 상품 문맥을 바탕으로 상품명·검색어 초안을 Gemini 로 생성한다.
 * 적합한 응답을 받지 못하면(키 미설정/API 오류/JSON 파싱 실패/빈 결과) null. 결코 throw 하지 않는다.
 */
export async function draftProductNames(input: NameDraftInput): Promise<NameDraftResult | null> {
  const system =
    '당신은 한국 쿠팡 셀러의 상품명·검색어(SEO 키워드) 초안을 작성하는 카피라이터입니다. ' +
    '아래 상품 문맥을 바탕으로 "쿠팡 상품명 및 검색어 운영 가이드"를 지키는 초안을 제시하세요.\n' +
    `- 상품명 목표 글자 수 구간: ${input.nameTargetMin}~${input.nameTargetMax}자\n` +
    '- 상품명·검색어에 금지: 무료배송·특가·최저가·세일·1+1 같은 프로모션/배송 표현, ' +
    '판매자명(스토어명), ★☆♥ 같은 장식용 특수문자, 경쟁 브랜드명, 효능·효과를 단정하는 표현\n' +
    '- 같은 단어를 상품명 안에서 반복하지 않는다\n' +
    '- 검색어는 상품명에 이미 들어간 단어와 겹치지 않는 새로운 단어로 구성한다(가장 중요한 규칙)\n' +
    '- 이미 등록된 검색어와 겹치거나 유사한 검색어는 제안하지 않는다\n' +
    '- 상품명 3개, 검색어 10개 내외를 제시한다'

  const lines: string[] = [`[판매채널] ${input.channelName}`, `[기준 상품명] ${input.productName}`]
  if (input.brandName) lines.push(`[브랜드] ${input.brandName}`)
  if (input.categoryName) lines.push(`[카테고리] ${input.categoryName}`)
  if (input.description) lines.push(`[상세 설명] ${input.description}`)
  if (input.features.length > 0) lines.push(`[특징] ${input.features.join(', ')}`)
  if (input.certifications.length > 0) lines.push(`[인증] ${input.certifications.join(', ')}`)
  if (input.optionSummary.length > 0) lines.push(`[옵션] ${input.optionSummary.join(' / ')}`)
  if (input.existingKeywords.length > 0) {
    lines.push(`[이미 등록된 검색어 — 중복 제안 금지] ${input.existingKeywords.join(', ')}`)
  }

  const schema =
    '반드시 순수 JSON만 반환(마크다운/설명/코드블록 금지):\n' +
    '{"names": ["상품명 후보1", "상품명 후보2", "상품명 후보3"], "keywords": ["검색어1", "검색어2", ...]}'

  const user = [...lines, '', schema].join('\n')

  const content = await callGemini(system, user)
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
        maxOutputTokens: 1024,
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

/** 모델 응답에서 첫 { … 마지막 } 구간을 JSON 파싱(코드블록/주변 텍스트 방어). */
function parseDraft(raw: string): NameDraftResult | null {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { names?: unknown; keywords?: unknown }
    const names = toStringList(obj.names, 3)
    const keywords = toStringList(obj.keywords, 20)
    if (names.length === 0 && keywords.length === 0) return null
    return { names, keywords }
  } catch {
    return null
  }
}
