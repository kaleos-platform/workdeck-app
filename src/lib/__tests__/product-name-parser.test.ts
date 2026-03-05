import { parseOptionName, parsePureProductName } from '../product-name-parser'

describe('product-name-parser', () => {
  it('Case1: 쉼표 기반 옵션 추출', () => {
    const productName =
      '미닝랩 그린펠트 수납박스 접이식 덮개형 바구니 장난감 기저귀 정리함, 2개, M(32X42X7.5), 딥그린'

    expect(parsePureProductName(productName)).toBe(
      '미닝랩 그린펠트 수납박스 접이식 덮개형 바구니 장난감 기저귀 정리함'
    )
    expect(parseOptionName(productName)).toBe('2개/M(32X42X7.5)/딥그린')
  })

  it('Case2: 수량 토큰 유지', () => {
    const productName = '미닝랩 환경교육 재생펠트 키링 DIY 키트, 별, 1개'

    expect(parsePureProductName(productName)).toBe('미닝랩 환경교육 재생펠트 키링 DIY 키트')
    expect(parseOptionName(productName)).toBe('별/1개')
  })

  it('Case3: 사이즈/색상 옵션 추출', () => {
    const productName = '에이엠엘 오가닉 순면 스트라이프 밴딩 베개커버 국산 여행용, S(40X60), 블루'

    expect(parsePureProductName(productName)).toBe(
      '에이엠엘 오가닉 순면 스트라이프 밴딩 베개커버 국산 여행용'
    )
    expect(parseOptionName(productName)).toBe('S(40X60)/블루')
  })

  it('기존 JSON 형식 옵션도 추출', () => {
    const productName = '샘플상품, {"구성":"5P"},{"사이즈":"M"}'

    expect(parseOptionName(productName)).toBe('5P/M')
  })

  it('옵션이 없으면 null 반환', () => {
    expect(parseOptionName('옵션 없는 상품명')).toBeNull()
    expect(parseOptionName(null)).toBeNull()
    expect(parseOptionName('')).toBeNull()
  })
})
