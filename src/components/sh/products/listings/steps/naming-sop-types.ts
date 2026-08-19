// 상품명 작성 SOP 위저드 공용 타입 — 가이드 §22 STEP 01~08.
//
// 위저드 상태는 전부 컴포넌트 로컬이다. 초안을 DB 에 저장하지 않으므로
// 여기에는 Prisma 모델과 1:1 대응하는 타입이 없다.

import type { KeywordTypeKey } from '@/lib/sh/keyword-score'

/** §22 STEP01 Fact Sheet — 항목명은 가이드 표기 그대로. */
export type FactSheet = {
  brand: string
  productGroup: string
  productType: string
  material: string
  keyFeature: string
  target: string
  purpose: string
  spec: string
  quantity: string
  options: string
}

export const EMPTY_FACT_SHEET: FactSheet = {
  brand: '',
  productGroup: '',
  productType: '',
  material: '',
  keyFeature: '',
  target: '',
  purpose: '',
  spec: '',
  quantity: '',
  options: '',
}

export const FACT_SHEET_FIELDS: {
  key: keyof FactSheet
  label: string
  placeholder: string
  /** 상품 마스터에서 프리필되는 항목인지 (UI 배지용) */
  prefilled?: boolean
}[] = [
  { key: 'brand', label: '브랜드', placeholder: '예: 모노웨어', prefilled: true },
  { key: 'productGroup', label: '상품군', placeholder: '예: 여성 속옷', prefilled: true },
  { key: 'productType', label: '상품유형', placeholder: '예: 팬티' },
  { key: 'material', label: '소재', placeholder: '예: 텐셀 모달' },
  { key: 'keyFeature', label: '핵심 특징', placeholder: '예: 부드러운 원단' },
  { key: 'target', label: '대상', placeholder: '예: 여성' },
  { key: 'purpose', label: '용도', placeholder: '예: 데일리' },
  { key: 'spec', label: '규격', placeholder: '예: 미디 / 120cm' },
  { key: 'quantity', label: '수량', placeholder: '예: 3매' },
  { key: 'options', label: '옵션', placeholder: '예: 색상, 사이즈', prefilled: true },
]

/** §22 STEP04 템플릿 `[브랜드] [핵심 특징] [메인 키워드] [서브 특징] [규격/수량]` */
export type NameParts = {
  brand: string
  keyFeature: string
  main: string
  subFeature: string
  spec: string
}

/** §22 STEP06 에서 수집한 검색어 후보 1건. */
export type ResearchTerm = {
  keyword: string
  /** KEYWORD_SOURCE_LABELS 의 키 */
  source: ResearchSource
  /** §13 A~G 분류 (STEP07) */
  type: KeywordTypeKey
}

export type ResearchSource =
  | 'COUPANG_AUTOCOMPLETE'
  | 'COUPANG_RELATED'
  | 'COUPANG_TOP_PRODUCT'
  | 'COUPANG_REVIEW'
  | 'AD_KEYWORD'
  | 'CUSTOMER_INQUIRY'
  | 'INTERNAL'

/** §22 STEP06 조사 순서 그대로. 수동 입력 시 고를 수 있는 출처. */
export const RESEARCH_SOURCE_ORDER: ResearchSource[] = [
  'COUPANG_AUTOCOMPLETE',
  'COUPANG_RELATED',
  'COUPANG_TOP_PRODUCT',
  'COUPANG_REVIEW',
  'AD_KEYWORD',
  'CUSTOMER_INQUIRY',
  'INTERNAL',
]

/**
 * §13 A~G 분류 버킷. COMPETITOR 는 버킷이 아니라 배제 사유이므로 넣지 않는다
 * (validateKeywords 가 경쟁 브랜드를 ERROR 로 잡는다). UNCLASSIFIED 는 미배정 보관함.
 */
export const CLASSIFY_BUCKETS: KeywordTypeKey[] = [
  'SYNONYM',
  'PARENT_CATEGORY',
  'MATERIAL',
  'SHAPE',
  'PURPOSE',
  'FEATURE',
  'ALIAS',
]

export const STEP_TITLES = [
  '상품 Fact Sheet 작성',
  '메인 키워드 1개 선정',
  '서브 키워드 후보 작성',
  '상품명 생성',
  '상품명 정리',
  '쿠팡 검색어 조사',
  '검색어 후보 정리',
  '중복 제거',
] as const

export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
