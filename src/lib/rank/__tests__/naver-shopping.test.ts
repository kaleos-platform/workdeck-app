// fixtures/naver-shop.json 은 손으로 만든 합성 데이터다(실제 네이버 응답 아님).
// 실제 API 키가 생기면 실응답으로 교체하고 매칭 규칙을 다시 확인할 것.
import fixture from './fixtures/naver-shop.json'
import { matchNaverRank, rankSourceForUrl, searchNaverShopping } from '../naver-shopping'

const items = fixture.items
const OPTS = { clientId: 'id', clientSecret: 'secret' }

describe('matchNaverRank', () => {
  it('찾으면 1-base 위치', () => {
    expect(matchNaverRank(items, 'https://smartstore.naver.com/ours/products/7777777')).toEqual({
      found: true,
      rank: 7,
    })
  })
  it('없으면 found:false', () => {
    expect(matchNaverRank(items, 'https://smartstore.naver.com/ours/products/999')).toEqual({
      found: false,
    })
  })
  it('상품 id 를 못 뽑는 URL 은 unmatchable', () => {
    expect(matchNaverRank(items, 'https://smartstore.naver.com/ours')).toEqual({
      unmatchable: true,
    })
    expect(matchNaverRank(items, null)).toEqual({ unmatchable: true })
  })
})

describe('rankSourceForUrl', () => {
  it('호스트별 출처', () => {
    expect(rankSourceForUrl('https://www.smartstore.naver.com/a/products/1')).toBe('NAVER_SHOPPING')
    expect(rankSourceForUrl('https://brand.naver.com/a/products/1')).toBe('NAVER_SHOPPING')
    expect(rankSourceForUrl('https://www.coupang.com/vp/products/1')).toBe('COUPANG')
    expect(rankSourceForUrl('https://example.com/x')).toBeNull()
    expect(rankSourceForUrl('not a url')).toBeNull()
    expect(rankSourceForUrl(null)).toBeNull()
  })
})

describe('searchNaverShopping', () => {
  it('성공 시 items 를 정규화한다', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [{ ...items[0], productType: 2 }] }),
    }))
    const r = await searchNaverShopping('타월', {
      ...OPTS,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(r).toEqual({ ok: true, items: [{ ...items[0], productType: '2' }] })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('display=100')
    expect((init.headers as Record<string, string>)['X-Naver-Client-Id']).toBe('id')
  })
  it('HTTP 오류는 HTTP_<status>', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 429 })) as unknown as typeof fetch
    expect(await searchNaverShopping('타월', { ...OPTS, fetchImpl })).toEqual({
      ok: false,
      errorCode: 'HTTP_429',
    })
  })
  it('네트워크 throw 는 NETWORK', async () => {
    const fetchImpl = (async () => {
      throw new Error('boom')
    }) as unknown as typeof fetch
    expect(await searchNaverShopping('타월', { ...OPTS, fetchImpl })).toEqual({
      ok: false,
      errorCode: 'NETWORK',
    })
  })
})
