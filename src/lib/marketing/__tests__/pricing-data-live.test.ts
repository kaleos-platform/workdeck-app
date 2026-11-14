import { DECK_PRICING_ROWS, withLivePrices } from '../pricing-data'

describe('withLivePrices', () => {
  it('DB 공급가로 공급가·VAT 포함가를 다시 계산한다', () => {
    const rows = withLivePrices(DECK_PRICING_ROWS, { recruiting: 30000 })
    const recruiting = rows.find((r) => r.slug === 'recruiting')!
    expect(recruiting.supplyPrice).toBe(30000)
    expect(recruiting.totalPrice).toBe(33000)
  })

  it('DB 값이 없는 업무는 기본값 유지', () => {
    const rows = withLivePrices(DECK_PRICING_ROWS, {})
    expect(rows).toEqual(DECK_PRICING_ROWS)
  })
})
