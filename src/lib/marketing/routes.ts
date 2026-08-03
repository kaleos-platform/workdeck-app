/**
 * proxy.ts(Edge 미들웨어 번들)와 공유되는 마케팅 경로 상수.
 *
 * 주의: 이 파일은 문자열 리터럴만 export 한다.
 * `deck-meta.ts`, `deck-routes.ts` 등 다른 모듈을 절대 import 하지 말 것 —
 * proxy.ts(Edge 런타임)가 이 파일을 가져오므로 번들에 불필요한 의존성이
 * 섞이면 Edge 호환성이 깨질 수 있다.
 */

/** deck 랜딩 6개의 루트 슬러그 (앱 라우트와 충돌 없음 — 정적 라우트 우선) */
export const MARKETING_DECK_SLUGS = [
  'coupang-ads',
  'seller-hub',
  'sales-content',
  'finance',
  'recruiting',
  'blog-ops',
] as const

export type MarketingDeckSlugString = (typeof MARKETING_DECK_SLUGS)[number]

/** 마케팅 도메인에서만 서빙되는 전체 경로 (deck 랜딩 + 공용 페이지) */
export const MARKETING_ONLY_PATHS: readonly string[] = [
  ...MARKETING_DECK_SLUGS.map((slug) => `/${slug}`),
  '/pricing',
  '/blog',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
]
