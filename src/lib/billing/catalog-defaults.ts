/**
 * BillingDeckProduct 시드값 단일 출처.
 * prisma/seed.ts와 마케팅 pricing 페이지(src/lib/marketing/pricing-data.ts)가
 * 이 배열을 공유한다 — 값이 두 곳에서 따로 관리되며 어긋나는 것을 방지.
 *
 * 가격은 공급가(VAT 별도) KRW. 정식 유료 전환 전까지는 예정가로만 보관된다.
 */
export interface DeckCatalogDefault {
  id: string
  name: string
  monthlyPrice: number
}

/**
 * 가격 정책 (2026-08 개정):
 * - 표시 기준은 VAT 포함액이며, 여기 저장하는 값은 공급가(VAT 별도).
 *   공급가 × 1.1이 딱 떨어지도록 만원 단위로 설정한다 (예: 50,000 → 55,000).
 * - 순위: 브랜드 운영 > 재무 관리 > 쿠팡 광고 관리 > 세일즈 콘텐츠 = 모집 관리.
 * - 전 업무 변동원가 대비 마진 70% 이상을 목표로 한다.
 *   세일즈 콘텐츠만 LLM 토큰이 변동원가 대부분이라, 생성 건수 상한(월 20건 내외)과
 *   Sonnet급 모델 사용이 마진 75% 유지의 전제 조건이다. 상한 미도입 상태에서
 *   Opus급으로 월 40건 생성되면 마진이 30%까지 떨어진다.
 */
export const DECK_CATALOG_DEFAULTS: DeckCatalogDefault[] = [
  { id: 'seller-hub', name: '브랜드 운영', monthlyPrice: 50000 },
  { id: 'finance', name: '재무 관리', monthlyPrice: 40000 },
  { id: 'coupang-ads', name: '쿠팡 광고 관리', monthlyPrice: 30000 },
  { id: 'sales-content', name: '세일즈 콘텐츠', monthlyPrice: 20000 },
  { id: 'recruiting', name: '모집 관리', monthlyPrice: 20000 },
]
