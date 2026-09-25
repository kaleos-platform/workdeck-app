import { matchesPaymentAmount } from '../order-search'

describe('matchesPaymentAmount', () => {
  it.each(['390', '39000', '39,000', '39 000', '39,000원'])(
    '금액 39000에 검색어 %s가 일치한다',
    (query) => {
      expect(matchesPaymentAmount('39000', query)).toBe(true)
    }
  )

  it.each(['상품39000', '원39000', ''])('숫자 금액 검색어가 아닌 %s는 일치하지 않는다', (query) => {
    expect(matchesPaymentAmount('39000', query)).toBe(false)
  })

  it('금액이 null이면 일치하지 않는다', () => {
    expect(matchesPaymentAmount(null, '39000')).toBe(false)
  })
})
