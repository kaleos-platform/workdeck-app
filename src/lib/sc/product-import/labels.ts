// 상품 정보 어휘 — seller-ops 임포트와 링크 추출이 공유한다.
//
// customFields 의 key 는 아이데이션 프롬프트에 `- {key}: {value}` 로 그대로 나가므로
// (src/lib/sc/prompts.ts renderProduct) 사실상 AI 가 읽는 레이블이다.
// 두 경로가 같은 어휘를 써야 상품끼리 호환된다.

export const PRODUCT_FIELD_LABELS = {
  description: '상세 설명',
  features: '핵심 기능',
  certifications: '인증·규격',
  manufacturer: '제조사',
  originCountry: '원산지',
  capacity: '용량·규격',
  cautions: '주의사항',
  brand: '브랜드',
  msrp: '권장 소비자가',
  materials: '소재·구성',
  customization: '맞춤 제작',
  ordering: '대량 주문 조건',
  useCases: '활용 방법',
  esgEvidence: 'ESG 근거',
  missingInfo: '추가 확인 필요',
} as const

export function clampText(v: string, max: number): string {
  const t = v.trim()
  return t.length > max ? t.slice(0, max) : t
}

/**
 * 첫 문장만 뽑아 한 줄 소개로 쓴다. 문장 종결이 없으면 전체를 반환하고,
 * 길이 clamp 는 호출부가 담당한다.
 */
export function firstSentence(v: string): string {
  const t = v.trim()
  if (!t) return ''
  const m = t.match(/^[\s\S]*?[.!?。！？](\s|$)/)
  const picked = m ? m[0] : t.split(/\n/)[0]
  return picked.trim()
}
