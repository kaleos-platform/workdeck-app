/**
 * 상품 자동 설명 생성 — 소재(텍스트/이미지/PDF)에서 상품 정보를 추출한다.
 * (선례: src/lib/finance/ai-suggest.ts 의 @google/genai 직접 호출 패턴)
 *
 * 재무 추천과 달리 이 모듈은 "미분류 유지"가 아니라 사용자가 기다리는 생성 결과이므로
 * 실패를 삼키지 않고 전부 throw 한다 — 무음 null은 "소재에 없음"과 "AI 호출 실패"를
 * 구분할 수 없게 만들어 사용자를 오도한다.
 *
 * 키 = GEMINI_API_KEY(레포 컨벤션) 우선, 없으면 GOOGLE_AI_API_KEY 폴백.
 * 모델 = AI_PRIMARY_MODEL(기본 gemini-2.5-flash).
 */
// @google/genai는 ESM 전용 빌드라 정적 import 하면 이 모듈을 참조하는 모든 Jest 테스트가
// 파싱 단계에서 죽는다(라우트 테스트 포함). 런타임 값은 extractProductInfo 안에서
// 동적 import 하고, 여기서는 타입만 가져온다(타입 import는 컴파일 시 소거됨).
import type { GoogleGenAI, Part, Schema, Type } from '@google/genai'

import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_LIST_FIELD_MAX_ITEMS as MAX_ARRAY_ITEMS,
  PRODUCT_LIST_FIELD_MAX_ITEM_LENGTH as MAX_ITEM_CHARS,
} from '@/lib/sh/constants'

export const EXTRACT_MODEL = process.env.AI_PRIMARY_MODEL ?? 'gemini-2.5-flash'

export type ExtractSourcePart =
  | { kind: 'text'; label: string; text: string }
  | { kind: 'inline'; mimeType: string; data: Buffer; fileName: string }

export type ExtractedProductInfo = {
  description: string | null
  features: string[]
  certifications: string[]
  ingredients: string[]
  capacity: string | null
  originCountry: string | null
  manufacturer: string | null
  cautions: string[]
  confidence: number
  notes: string | null
  /** 길이 제한으로 잘리거나(clamp) 항목 수가 잘린(cap) 필드명 목록 */
  truncatedFields: string[]
}

export type ProductExtractErrorCode =
  | 'AI_KEY_MISSING'
  | 'PARSE_FAILED'
  | 'EMPTY_RESPONSE'
  | 'API_FAILED'
  | 'TIMEOUT'

export class ProductExtractError extends Error {
  readonly code: ProductExtractErrorCode
  /** PARSE_FAILED일 때 원본 응답(최대 20,000자) — 호출측이 ProductExtractionJob.rawResponse에 저장 */
  readonly rawText?: string
  constructor(code: ProductExtractErrorCode, message: string, rawText?: string) {
    super(message)
    this.name = 'ProductExtractError'
    this.code = code
    this.rawText = rawText
  }
}

// "있는 그대로 발췌" 지시를 전역으로 걸면 features가 항상 최단 키워드로 수축한다
// (temperature 0.1에서 모델은 더 엄격한 지시를 택함). 그래서 '사실'과 '표현'을 분리해
// 축자 전사는 인증번호/성분처럼 표기가 곧 정보인 필드에만 적용한다.
const SYSTEM_INSTRUCTION = [
  '당신은 한국 이커머스 상품 정보를 정리하는 보조원입니다. 제공된 소재(텍스트/이미지/PDF)를 바탕으로 상품 정보를 정리하세요.',
  '',
  '[사실과 표현의 구분]',
  '- 사실: 소재에 실제로 나타난 내용만 사용하세요. 소재에 없는 사실·수치·효능·인증을 추가하거나 추측하지 마세요.',
  '- 표현: 소재의 상세페이지 카피와 이미지 속 문구를 참고해 문장을 다시 다듬어도 됩니다. 사실을 바꾸지 않는 재구성은 허용됩니다.',
  '- 소재에 없는 필드는 null 또는 빈 배열로 두세요.',
  '',
  '[원문 표기를 그대로 옮길 필드]',
  'certifications(KC 등 인증번호), ingredients, capacity, manufacturer, originCountry는 소재의 표기를 그대로 옮기세요.',
  '',
  '[description]',
  '한국어 평문 2~5문장으로 작성하세요.',
  '',
  '[features — 상품의 "특징"]',
  '- 주제 단위로 묶으세요. 착용·사용 구조, 소재·원단, 기능, 핏·사이즈, 관리·세탁, 구성 등 주제마다 항목 하나를 만들고, 같은 주제를 여러 항목으로 잘게 쪼개지 마세요.',
  '- 각 항목에는 근거가 되는 속성과 그로 인한 사용자 이점이 함께 담겨야 합니다. 수식어나 단어만 나열하지 마세요.',
  '- 명사구로 끝맺으세요(예: ~구조, ~원단, ~설계). "~입니다", "~합니다" 같은 서술형 어미는 쓰지 마세요.',
  '- 나쁜 예: "조이지 않는 편안함"',
  '- 좋은 예: "티셔츠처럼 위에서 아래로 편하게 입고 벗는 런닝형 구조"',
  '- 인증번호는 certifications에, 주의·경고 문구는 cautions에 넣고 features에는 넣지 마세요.',
  '- 소재가 빈약하면 억지로 항목 수를 늘리지 마세요.',
].join('\n')

/** 프롬프트 개정 버전 — ProductExtractionJob.promptVersion에 기록해 신/구 결과를 구분한다. */
export const EXTRACT_PROMPT_VERSION = 'v2'

// truncatedFields는 응답 스키마에서 제외하고 로컬에서 계산한다.
// `Schema` 타입 명시 — SchemaUnion = Schema | unknown 이라 무주석이면 tsc가 형태를 전혀 검사하지 않는다.
const RESPONSE_SCHEMA: Schema = {
  type: 'OBJECT' as Type,
  properties: {
    description: { type: 'STRING' as Type, nullable: true },
    features: {
      type: 'ARRAY' as Type,
      description:
        '상품의 특징. 주제(착용·사용 구조, 소재·원단, 기능, 핏·사이즈, 관리·세탁, 구성 등) 단위로 묶어 주제마다 항목 하나. 인증번호·주의사항은 제외.',
      items: {
        type: 'STRING' as Type,
        description:
          '근거가 되는 속성과 그로 인한 사용자 이점을 함께 담은 명사구. 예: "티셔츠처럼 위에서 아래로 편하게 입고 벗는 런닝형 구조"',
      },
    },
    certifications: { type: 'ARRAY' as Type, items: { type: 'STRING' as Type } },
    ingredients: { type: 'ARRAY' as Type, items: { type: 'STRING' as Type } },
    capacity: { type: 'STRING' as Type, nullable: true },
    originCountry: { type: 'STRING' as Type, nullable: true },
    manufacturer: { type: 'STRING' as Type, nullable: true },
    cautions: { type: 'ARRAY' as Type, items: { type: 'STRING' as Type } },
    confidence: { type: 'NUMBER' as Type },
    notes: { type: 'STRING' as Type, nullable: true },
  },
  required: ['description', 'features', 'certifications', 'confidence'],
}

function buildParts(productName: string, parts: ExtractSourcePart[]): Part[] {
  const result: Part[] = [{ text: `[상품명] ${productName}` }]
  parts.forEach((part, i) => {
    const n = i + 1
    if (part.kind === 'text') {
      result.push({ text: `[소재 ${n}: ${part.label}]\n${part.text}` })
    } else {
      result.push({ text: `[소재 ${n}: 첨부파일 ${part.fileName}]` })
      result.push({ inlineData: { mimeType: part.mimeType, data: part.data.toString('base64') } })
    }
  })
  return result
}

/**
 * Gemini로 상품 정보를 추출한다. 키 미설정/호출 실패/빈 응답/파싱 실패 시 전부 throw.
 */
export async function extractProductInfo(input: {
  productName: string
  parts: ExtractSourcePart[]
  signal?: AbortSignal
}): Promise<{
  result: ExtractedProductInfo
  raw: string
  model: string
  usage: { inputTokens: number | null; outputTokens: number | null }
  latencyMs: number
}> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new ProductExtractError('AI_KEY_MISSING', 'AI API 키가 설정되지 않았습니다')

  const contents = [{ role: 'user' as const, parts: buildParts(input.productName, input.parts) }]

  const startedAt = Date.now()
  let res: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>
  try {
    const { GoogleGenAI: GoogleGenAiCtor } = await import('@google/genai')
    const ai = new GoogleGenAiCtor({ apiKey })
    res = await ai.models.generateContent({
      model: EXTRACT_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
        maxOutputTokens: 8192,
        abortSignal: input.signal,
      },
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ProductExtractError('TIMEOUT', 'AI 호출이 시간 초과되었습니다')
    }
    const message = err instanceof Error ? err.message : String(err)
    throw new ProductExtractError('API_FAILED', `AI 호출 실패: ${message}`)
  }
  const latencyMs = Date.now() - startedAt

  const text = res.text
  if (!text || !text.trim()) {
    // finishReason(예: MAX_TOKENS로 사고 예산 소진, SAFETY 차단)을 메시지에 남겨야
    // "소재에 없어서 비었는지" vs "호출이 실패했는지"를 사후에 구분할 수 있다.
    const finishReason = res.candidates?.[0]?.finishReason ?? 'UNKNOWN'
    throw new ProductExtractError(
      'EMPTY_RESPONSE',
      `AI 응답이 비어 있습니다 (finishReason: ${finishReason})`,
      JSON.stringify({ finishReason, usageMetadata: res.usageMetadata ?? null }).slice(0, 20000)
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ProductExtractError(
      'PARSE_FAILED',
      'AI 응답 JSON 파싱에 실패했습니다',
      text.slice(0, 20000)
    )
  }

  // candidatesTokenCount는 가시 출력 토큰만 집계 — thinking 토큰(thoughtsTokenCount)도
  // 과금 대상이므로 크레딧 정산 누락을 막기 위해 합산한다.
  const usage = res.usageMetadata
  const outputTokens =
    usage?.candidatesTokenCount != null || usage?.thoughtsTokenCount != null
      ? (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
      : null

  return {
    result: normalizeExtracted(parsed),
    raw: text,
    model: res.modelVersion ?? EXTRACT_MODEL,
    usage: {
      inputTokens: usage?.promptTokenCount ?? null,
      outputTokens,
    },
    latencyMs,
  }
}

const ARRAY_FIELDS = ['features', 'certifications', 'ingredients', 'cautions'] as const

function toNullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed ? trimmed : null
}

function normalizeStringArray(v: unknown): { items: string[]; truncated: boolean } {
  const raw = Array.isArray(v) ? v : []
  const seen = new Set<string>()
  const out: string[] = []
  let truncated = false
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    let trimmed = entry.trim()
    if (!trimmed) continue
    if (trimmed.length > MAX_ITEM_CHARS) {
      trimmed = trimmed.slice(0, MAX_ITEM_CHARS)
      truncated = true
    }
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  if (out.length > MAX_ARRAY_ITEMS) {
    truncated = true
    return { items: out.slice(0, MAX_ARRAY_ITEMS), truncated }
  }
  return { items: out, truncated }
}

function normalizeConfidence(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * AI 응답(unknown/부분적일 수 있음)을 안전하게 정규화한다. 형태가 어긋나도 절대 throw하지 않고
 * 최대한 값을 살려낸다(defensive coercion) — 파싱 실패는 이 함수 이전 단계(JSON.parse)의 책임.
 */
export function normalizeExtracted(raw: unknown): ExtractedProductInfo {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const truncatedFields: string[] = []

  let description = toNullableString(obj.description)
  if (description && description.length > PRODUCT_DESCRIPTION_MAX) {
    description = description.slice(0, PRODUCT_DESCRIPTION_MAX)
    truncatedFields.push('description')
  }

  const arrays: Record<(typeof ARRAY_FIELDS)[number], string[]> = {
    features: [],
    certifications: [],
    ingredients: [],
    cautions: [],
  }
  for (const field of ARRAY_FIELDS) {
    const { items, truncated } = normalizeStringArray(obj[field])
    arrays[field] = items
    if (truncated) truncatedFields.push(field)
  }

  return {
    description,
    features: arrays.features,
    certifications: arrays.certifications,
    ingredients: arrays.ingredients,
    capacity: toNullableString(obj.capacity),
    originCountry: toNullableString(obj.originCountry),
    manufacturer: toNullableString(obj.manufacturer),
    cautions: arrays.cautions,
    confidence: normalizeConfidence(obj.confidence),
    notes: toNullableString(obj.notes),
    truncatedFields,
  }
}
