// 네이버 쇼핑 검색 API(openapi.naver.com/v1/search/shop.json) 조회 + 순위 매칭.
//
// 검색 API 는 자연 결과만 돌려준다(광고 없음) → 이 출처의 adShown 은 항상 false.
// fetchImpl 은 테스트 주입 전용 — 환경변수·라우트로 가짜 공급자를 바꿔 끼우지 않는다.

import type { RankSource } from '@/generated/prisma/client'

export type NaverShopItem = {
  title: string
  link: string
  productId: string
  productType: string
  mallName: string
}

export type NaverSearchResult =
  | { ok: true; items: NaverShopItem[] }
  | { ok: false; errorCode: string }

export type NaverSearchOpts = {
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
}

const ENDPOINT = 'https://openapi.naver.com/v1/search/shop.json'

/** 키워드 하나를 sim 정렬 상위 100건으로 조회한다. 절대 throw 하지 않는다. */
export async function searchNaverShopping(
  keyword: string,
  opts: NaverSearchOpts
): Promise<NaverSearchResult> {
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const res = await doFetch(
      `${ENDPOINT}?query=${encodeURIComponent(keyword)}&display=100&start=1&sort=sim`,
      {
        headers: {
          'X-Naver-Client-Id': opts.clientId,
          'X-Naver-Client-Secret': opts.clientSecret,
        },
      }
    )
    if (!res.ok) return { ok: false, errorCode: `HTTP_${res.status}` }
    const json = (await res.json()) as { items?: Array<Record<string, unknown>> }
    const items = (json.items ?? []).map((it) => ({
      title: String(it.title ?? ''),
      link: String(it.link ?? ''),
      productId: String(it.productId ?? ''),
      productType: String(it.productType ?? ''),
      mallName: String(it.mallName ?? ''),
    }))
    return { ok: true, items }
  } catch {
    return { ok: false, errorCode: 'NETWORK' }
  }
}

/** 상품 페이지 URL 의 호스트로 순위 조회 출처를 정한다. 지원하지 않으면 null. */
export function rankSourceForUrl(pageUrl: string | null): RankSource | null {
  if (!pageUrl) return null
  let host: string
  try {
    host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  if (host === 'smartstore.naver.com' || host === 'brand.naver.com') return 'NAVER_SHOPPING'
  if (host === 'coupang.com' || host.endsWith('.coupang.com')) return 'COUPANG'
  return null
}

export type NaverMatch = { found: true; rank: number } | { found: false } | { unmatchable: true }

/**
 * 검색 결과에서 우리 상품의 순위(1-base)를 찾는다.
 *
 * PROVISIONAL: 매칭 규칙(link 의 /products/<id> 또는 productId 일치)은 합성 fixture 로만
 * 검증했다. 실제 API 키가 생기면 실제 응답으로 반드시 확정할 것 — 특히 productId 가
 * 스마트스토어 채널상품번호와 같은지, link 가 네이버 가격비교 URL 로 오지 않는지.
 */
export function matchNaverRank(items: NaverShopItem[], pageUrl: string | null): NaverMatch {
  const id = pageUrl
    ? (() => {
        try {
          return new URL(pageUrl).pathname.match(/\/products\/(\d+)/)?.[1] ?? null
        } catch {
          return null
        }
      })()
    : null
  if (!id) return { unmatchable: true }
  const idx = items.findIndex((it) => it.link.includes(`/products/${id}`) || it.productId === id)
  return idx >= 0 ? { found: true, rank: idx + 1 } : { found: false }
}
