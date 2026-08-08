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

export const DECK_CATALOG_DEFAULTS: DeckCatalogDefault[] = [
  { id: 'coupang-ads', name: '쿠팡 광고 관리', monthlyPrice: 29000 },
  { id: 'seller-hub', name: '브랜드 운영', monthlyPrice: 29000 },
  { id: 'finance', name: '재무 관리', monthlyPrice: 19000 },
  { id: 'sales-content', name: '세일즈 콘텐츠', monthlyPrice: 14900 },
  { id: 'recruiting', name: '모집 관리', monthlyPrice: 14900 },
]
