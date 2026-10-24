import { EXTERNAL_SOURCE_LABEL, isExternalSource } from '../external-sources'

describe('external-sources', () => {
  it('N배송 소스를 인식한다', () => {
    expect(isExternalSource('naver_nbaesong')).toBe(true)
  })

  it('N배송 라벨', () => {
    expect(EXTERNAL_SOURCE_LABEL.naver_nbaesong).toBe('스마트스토어 N배송')
  })
})
