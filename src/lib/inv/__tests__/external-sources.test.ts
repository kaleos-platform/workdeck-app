import {
  channelSourceLabel,
  isExternalSource,
  isNbaesongSource,
  nbaesongExternalSource,
  nbaesongStoreKey,
} from '../external-sources'

describe('external-sources', () => {
  it('N배송은 보관장소 소스가 아니다', () => {
    expect(isExternalSource('naver_nbaesong')).toBe(false)
    expect(isExternalSource('naver_nbaesong:aml')).toBe(false)
  })

  it('nbaesongExternalSource', () => {
    expect(nbaesongExternalSource('kreamd')).toBe('naver_nbaesong:kreamd')
  })

  it('isNbaesongSource', () => {
    expect(isNbaesongSource('naver_nbaesong:aml')).toBe(true)
    expect(isNbaesongSource('naver_nbaesong:')).toBe(false)
    expect(isNbaesongSource('coupang_rocket_growth')).toBe(false)
  })

  it('nbaesongStoreKey', () => {
    expect(nbaesongStoreKey('naver_nbaesong:aml')).toBe('aml')
    expect(nbaesongStoreKey('coupang_rocket_growth')).toBeNull()
  })

  it('channelSourceLabel', () => {
    expect(channelSourceLabel('naver_nbaesong:aml')).toBe('스마트스토어 N배송')
    expect(channelSourceLabel('coupang_rocket_growth')).toBe('쿠팡 로켓그로스')
    expect(channelSourceLabel(null)).toBeNull()
  })
})
