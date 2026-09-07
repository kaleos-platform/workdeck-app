// seller-ops(seller-hub) 상품 → 세일즈 콘텐츠 상품 초안 매핑.
//
// 복사본을 만드는 것이지 원본과 연결하지 않는다(동기화·출처 기록 없음).
// customFields 의 key 는 아이데이션 프롬프트에 `- {key}: {value}` 로 그대로 실리므로
// (src/lib/sc/prompts.ts renderProduct), 링크 추출 경로와 같은 한국어 어휘를 쓴다.

import { PRODUCT_FIELD_LABELS, clampText, firstSentence } from './labels'

export type InvProductLike = {
  name?: unknown
  description?: unknown
  features?: unknown
  certifications?: unknown
  manufacturer?: unknown
  manufactureCountry?: unknown
  msrp?: unknown
  status?: unknown
  brand?: { name?: unknown } | null
}

export type ProductDraft = {
  name: string
  oneLinerPitch: string
  customFields: { key: string; value: string }[]
  isActive: boolean
}

const NAME_MAX = 200
const PITCH_MAX = 200
const VALUE_MAX = 2000

/**
 * Json? 컬럼(features/certifications)은 과거 데이터 모양을 신뢰할 수 없다.
 * String(obj) 로 `[object Object]` 가 새는 것을 막는다.
 */
export function jsonToText(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    return v
      .map((item) => jsonToText(item))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const key of ['name', 'value', 'label', 'title']) {
      const picked = o[key]
      if (typeof picked === 'string' && picked.trim()) return picked.trim()
    }
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return ''
}

function formatMsrp(v: unknown): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `${n.toLocaleString('ko-KR')}원`
}

export function invProductToDraft(p: InvProductLike): ProductDraft {
  const description = jsonToText(p.description)

  const candidates: [string, string][] = [
    [PRODUCT_FIELD_LABELS.description, clampText(description, VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.features, clampText(jsonToText(p.features), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.certifications, clampText(jsonToText(p.certifications), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.brand, clampText(jsonToText(p.brand?.name), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.manufacturer, clampText(jsonToText(p.manufacturer), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.originCountry, clampText(jsonToText(p.manufactureCountry), VALUE_MAX)],
    [PRODUCT_FIELD_LABELS.msrp, formatMsrp(p.msrp)],
  ]

  return {
    // 공식 상품명(name). 관리명(internalName)은 내부 식별용이라 고객 대상 콘텐츠에 쓰지 않는다.
    name: clampText(jsonToText(p.name), NAME_MAX),
    oneLinerPitch: clampText(firstSentence(description), PITCH_MAX),
    // 빈 값은 항목 자체를 만들지 않는다 — 프롬프트에 빈 줄이 실리지 않게.
    customFields: candidates
      .filter(([, value]) => value.length > 0)
      .map(([key, value]) => ({ key, value })),
    isActive: p.status == null || p.status === 'ACTIVE',
  }
}
