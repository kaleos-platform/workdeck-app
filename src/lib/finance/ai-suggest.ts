/**
 * 재무 관리 Deck — 미분류 거래 AI 계정 제안(gap-fill).
 *
 * 규칙(결정적 classify.ts)으로 못 잡은 거래에만 사용자 액션으로 호출한다. AI는 "제안"만 하고,
 * 사용자가 수락하면 기존 분류 경로(learnRule)가 EXACT 규칙으로 학습 → 다음부터 AI 없이 자동 분류.
 *
 * 공급자: 재무 추천 전용으로 Gemini API(@google/genai)를 직접 호출한다.
 * (공유 텍스트 체인 generateTextWithFallback[codex/gemini-cli/ollama]은 건드리지 않음 — 재무만 분리.)
 * 키 = GEMINI_API_KEY(레포 컨벤션) 우선, 없으면 GOOGLE_AI_API_KEY(이미지와 공용 AI Studio 키) 폴백.
 * 모델 = AI_PRIMARY_MODEL(기본 gemini-2.5-flash). 키 미설정/오류/적합없음이면 null(미분류 유지). throw 안 함.
 */
import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODEL = 'gemini-2.5-flash'

export type SuggestCandidate = {
  id: string
  /** 운영 항목명(리프) */
  name: string
  /** 대분류(상위) 이름 — 없으면 null */
  group: string | null
  /** 수입/지출/이체 */
  kind: '수입' | '지출' | '이체'
}

export type SuggestTxnInput = {
  description: string | null
  counterparty: string | null
  amount: number
  direction: 'IN' | 'OUT'
}

export type CategorySuggestion = {
  categoryId: string
  categoryName: string
  reason: string
}

/**
 * 거래 1건에 대해 후보 운영 항목 중 가장 적합한 1개를 Gemini로 제안한다.
 * 적합 항목이 없거나 AI 사용 불가/파싱 실패면 null(미분류 유지). 결코 throw 하지 않는다.
 *
 * 후보는 긴 cuid 대신 번호(1-based)로 제시해 모델 응답 매칭을 안정화하고, 응답 number를
 * 후보 배열 인덱스로 검증한다(범위 밖/0 = 해당없음).
 */
export async function suggestCategory(
  input: SuggestTxnInput,
  candidates: SuggestCandidate[]
): Promise<CategorySuggestion | null> {
  if (candidates.length === 0) return null
  const desc = (input.description ?? input.counterparty ?? '').trim()
  if (!desc) return null

  const dirLabel = input.direction === 'IN' ? '수입' : '지출'
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.group ? `${c.group} › ` : ''}${c.name} [${c.kind}]`)
    .join('\n')

  const system =
    '당신은 한국의 소규모 이커머스 브랜드(의류·잡화 등 자체 상품 판매) 사장님의 장부를 정리하는 회계 보조원입니다. ' +
    '은행/카드 거래 1건의 거래처·적요를 보고 "무슨 용도의 돈인지" 추론해 후보 계정 항목 중 가장 적합한 1개를 고르세요. ' +
    '거래처명 단서 예: 섬유·원단·봉제·어패럴·의류 공급업체 지급=상품 매입, 택배·물류·풀필먼트사=택배비/풀필먼트, ' +
    '인쇄·디자인·촬영·스튜디오·리서치=콘텐츠·제작 또는 외주·용역, 세무사·회계사무소=세무·회계, ' +
    '플랫폼·PG=수수료. 회계 용어가 아니라 운영 항목 기준으로 판단하세요. ' +
    '가능한 한 가장 그럴듯한 1개를 고르고(사장님이 확인 후 수정 가능), 정말 어떤 후보와도 무관할 때만 0을 고르세요.'

  const schema =
    `반드시 순수 JSON만 반환(마크다운/설명/코드블록 금지):\n` +
    `{"number": <후보 번호 1~${candidates.length}, 적합 항목 없으면 0>, "reason": "<한국어 한 문장 근거>"}`

  const user = [
    `[거래] 방향: ${dirLabel} / 금액: ${Math.round(input.amount).toLocaleString('ko-KR')}원`,
    `적요·가맹점: ${desc}`,
    '',
    '[후보 계정 항목]',
    list,
    '',
    schema,
  ].join('\n')

  const content = await callGemini(system, user)
  if (!content) return null

  const parsed = parseSuggestion(content)
  if (!parsed) return null
  const idx = parsed.number - 1
  if (parsed.number <= 0 || idx < 0 || idx >= candidates.length) return null
  const chosen = candidates[idx]
  return {
    categoryId: chosen.id,
    categoryName: chosen.name,
    reason: parsed.reason.trim() || 'AI 추천',
  }
}

/**
 * Gemini API(@google/genai) 단발 호출 — 재무 추천 전용. 키 미설정/오류면 null.
 * 키=GEMINI_API_KEY→GOOGLE_AI_API_KEY 폴백, 모델=AI_PRIMARY_MODEL(기본 gemini-2.5-flash).
 * responseMimeType=application/json으로 JSON 유도.
 */
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
        temperature: 0.1,
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
        // 분류는 단순·결정적 작업 — thinking 비활성(속도·비용·출력예산 확보).
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
    const text = res.text
    return text && text.trim() ? text : null
  } catch {
    return null
  }
}

/** 모델 응답에서 첫 { … 마지막 } 구간을 JSON 파싱(코드블록/주변 텍스트 방어). */
function parseSuggestion(raw: string): { number: number; reason: string } | null {
  const text = raw.trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as { number?: unknown; reason?: unknown }
    const number = Number(obj.number)
    if (!Number.isFinite(number)) return null
    return { number, reason: typeof obj.reason === 'string' ? obj.reason : '' }
  } catch {
    return null
  }
}
