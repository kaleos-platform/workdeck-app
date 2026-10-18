import { detectChannelForUrl, normalizeHttpUrl } from '../product-page-url'

const ch = (id: string, name: string, storeUrl: string | null = null, extra = {}) => ({
  id,
  name,
  storeUrl,
  externalSource: null,
  isActive: true,
  ...extra,
})

describe('normalizeHttpUrl', () => {
  it('http/https 만 허용', () => {
    expect(normalizeHttpUrl(' https://a.com/x ')?.hostname).toBe('a.com')
    expect(normalizeHttpUrl('ftp://a.com')).toBeNull()
    expect(normalizeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeHttpUrl('nope')).toBeNull()
  })
})

describe('detectChannelForUrl', () => {
  it('storeUrl 경로 접두 일치', () => {
    const r = detectChannelForUrl('https://smartstore.naver.com/shop1/products/123', [
      ch('a', 'A', 'https://smartstore.naver.com/shop1'),
      ch('b', 'B', 'https://smartstore.naver.com/shop2'),
    ])
    expect(r).toEqual({ channelId: 'a', candidates: [{ id: 'a', name: 'A' }] })
  })

  it('가장 긴 접두가 우선', () => {
    const r = detectChannelForUrl('https://x.com/shop/sub/p/1', [
      ch('a', 'A', 'https://x.com/'),
      ch('b', 'B', 'https://x.com/shop/sub'),
    ])
    expect(r.channelId).toBe('b')
  })

  it('www·대소문자·끝 슬래시 무시', () => {
    const r = detectChannelForUrl('https://WWW.Shop.com/Items', [ch('a', 'A', 'https://shop.com/')])
    expect(r.channelId).toBe('a')
  })

  it('경로 경계: /shop1 은 /shop10 에 매칭되지 않음', () => {
    const r = detectChannelForUrl('https://x.com/shop10/p', [ch('a', 'A', 'https://x.com/shop1')])
    expect(r.channelId).toBeNull()
  })

  it('비활성·연동 채널 제외', () => {
    const r = detectChannelForUrl('https://x.com/p', [
      ch('a', 'A', 'https://x.com', { isActive: false }),
      ch('b', 'B', 'https://x.com', { externalSource: 'coupang' }),
    ])
    expect(r).toEqual({ channelId: null, candidates: [] })
  })

  it('쿠팡 폴백: 단일/복수', () => {
    const url = 'https://www.coupang.com/vp/products/1'
    expect(detectChannelForUrl(url, [ch('a', '쿠팡 로켓'), ch('b', '기타')]).channelId).toBe('a')
    const multi = detectChannelForUrl(url, [ch('a', '쿠팡 로켓'), ch('b', '쿠팡 마켓')])
    expect(multi.channelId).toBeNull()
    expect(multi.candidates).toHaveLength(2)
  })

  it('비 http URL 은 빈 결과', () => {
    expect(detectChannelForUrl('ftp://x.com', [ch('a', 'A', 'https://x.com')]).candidates).toEqual(
      []
    )
  })
})
