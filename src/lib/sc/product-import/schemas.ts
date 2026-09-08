import { z } from 'zod'
import { PRODUCT_FIELD_LABELS, clampText, firstSentence } from './labels'
import type { ProductDraft } from './map-inv-product'

// 상품 링크 추출 — AI 출력 스키마와 정규화.
//
// 길이 제약을 zod 에 걸지 않는 이유: 초과분을 거부하면 재시도 2회 중 1회를 길이 위반으로 태우고,
// 통과시켜도 productSchema(oneLinerPitch max 200)에서 POST 가 400 으로 하드 실패한다.
// 느슨히 파싱하고 normalizeExtracted 로 clamp 한다.

const looseString = z.string().optional()
const looseList = z.array(z.string()).optional()

export const productExtractSchema = z.object({
  name: looseString,
  oneLinerPitch: looseString,
  description: looseString,
  features: looseList,
  certifications: looseList,
  manufacturer: looseString,
  originCountry: looseString,
  capacity: looseString,
  cautions: looseList,
  materials: looseString,
  customization: looseString,
  ordering: looseString,
  useCases: looseList,
  esgEvidence: looseList,
  missingInfo: looseList,
})

export type ProductExtractRaw = z.infer<typeof productExtractSchema>

export const productExtractRequestSchema = z
  .object({
    url: z.string().trim().url().max(2048).optional(),
    pastedText: z.string().trim().min(50).max(30000).optional(),
  })
  .refine((v) => Boolean(v.url || v.pastedText), {
    message: '상품 URL 또는 상세 내용이 필요합니다',
  })

const NAME_MAX = 200
const PITCH_MAX = 200
const VALUE_MAX = 2000
const MAX_LIST_ITEMS = 20
const MAX_CUSTOM_FIELDS = 50

function listToText(v: string[] | undefined): string {
  if (!v?.length) return ''
  const seen = new Set<string>()
  const items: string[] = []
  for (const raw of v) {
    const t = typeof raw === 'string' ? raw.trim() : ''
    if (!t || seen.has(t)) continue
    seen.add(t)
    items.push(t)
    if (items.length >= MAX_LIST_ITEMS) break
  }
  return items.join('\n')
}

/** 절대 throw 하지 않는다 — 모델 출력이 어떻게 오든 저장 가능한 형태로 접는다. */
export function normalizeExtracted(raw: ProductExtractRaw): ProductDraft {
  const description = clampText(raw.description ?? '', VALUE_MAX)
  const pitch = raw.oneLinerPitch?.trim() || firstSentence(description)

  const candidates: [string, string][] = [
    [PRODUCT_FIELD_LABELS.description, description],
    [PRODUCT_FIELD_LABELS.features, clampText(listToText(raw.features), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.certifications, clampText(listToText(raw.certifications), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.manufacturer, clampText(raw.manufacturer ?? '', VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.originCountry, clampText(raw.originCountry ?? '', VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.capacity, clampText(raw.capacity ?? '', VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.cautions, clampText(listToText(raw.cautions), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.materials, clampText(raw.materials ?? '', VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.customization, clampText(raw.customization ?? '', VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.ordering, clampText(raw.ordering ?? '', VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.useCases, clampText(listToText(raw.useCases), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.esgEvidence, clampText(listToText(raw.esgEvidence), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.missingInfo, clampText(listToText(raw.missingInfo), VALUE_MAX)],
  ]

  return {
    name: clampText(raw.name ?? '', NAME_MAX),
    oneLinerPitch: clampText(pitch, PITCH_MAX),
    customFields: candidates
      .filter(([, value]) => value.length > 0)
      .slice(0, MAX_CUSTOM_FIELDS)
      .map(([key, value]) => ({ key, value })),
    isActive: true,
  }
}
