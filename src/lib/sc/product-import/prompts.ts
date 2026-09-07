import { PRODUCT_FIELD_LABELS } from './labels'

// 상품 상세페이지 텍스트 → 상품 정보 추출 프롬프트.
// 출력 키는 영문으로 받고(모델이 안정적) 라우트에서 한국어 레이블로 옮긴다.

export const MAX_SOURCE_CHARS = 24_000

export const PRODUCT_EXTRACT_SYSTEM_PROMPT = `당신은 상품 상세페이지를 읽고 마케팅 콘텐츠 제작에 필요한 상품 정보를 정리하는 분석가입니다.

규칙:
- 반드시 아래 JSON 스키마만 출력한다. 설명 문장, 마크다운 코드펜스 금지.
- 페이지에 실제로 적힌 내용만 쓴다. 근거가 없으면 필드를 생략한다 (지어내지 않는다).
- 모든 텍스트는 한국어로 쓴다 (브랜드명·모델명 등 고유명사는 원문 유지).
- name 은 판매 페이지의 상품명에서 판촉 문구("무료배송", "1+1", "당일발송" 등)를 걷어낸 순수 상품명으로 정리한다.
- oneLinerPitch 는 이 상품이 고객에게 주는 핵심 가치를 한 문장(200자 이내)으로 쓴다.
- features 는 사양 나열이 아니라 "무엇이 좋아지는가"를 담은 항목으로 쓴다. 최대 10개.
- certifications 는 문서에 명시된 인증·시험성적만 쓴다. 번호가 있으면 \`내용 (번호)\` 형식으로 병기한다.

JSON 스키마:
{
  "name": string,
  "oneLinerPitch": string,
  "description": string,      // 상품 설명 요약, 2000자 이내
  "features": string[],
  "certifications": string[],
  "manufacturer": string,
  "originCountry": string,
  "capacity": string,         // 용량·규격·사이즈
  "cautions": string[]        // 주의사항·관리 방법
}`

export function buildProductExtractPrompt(params: {
  sourceLabel: string
  text: string
}): string {
  return `다음 상품 페이지 내용을 분석해 JSON 을 생성하세요.

--- 출처: ${params.sourceLabel} ---
${params.text.slice(0, MAX_SOURCE_CHARS)}`
}

// 추출 결과가 어떤 한국어 항목으로 저장되는지 — UI 안내 문구에서 재사용
export const EXTRACTED_FIELD_LABELS = Object.values(PRODUCT_FIELD_LABELS)
