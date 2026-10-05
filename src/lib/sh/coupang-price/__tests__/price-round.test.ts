import { roundPriceTo10, ceilMinPriceTo10, checkPriceGuards } from '../price-round'

describe('10원 단위', () => {
  test('판매가는 반올림', () => {
    expect(roundPriceTo10(48237)).toBe(48240)
    expect(roundPriceTo10(48234)).toBe(48230)
    expect(roundPriceTo10(48230)).toBe(48230)
  })

  test('자동조정 하한은 올림 — 내리면 마진 밑으로 팔릴 수 있다', () => {
    expect(ceilMinPriceTo10(58191)).toBe(58200)
    expect(ceilMinPriceTo10(58200)).toBe(58200)
  })
})

describe('가드', () => {
  test('includeVat=false 시나리오는 차단', () => {
    const r = checkPriceGuards({ price: 48240, apMinSalePrice: 40000, includeVat: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('VAT')
  })

  test('apMinSalePrice 가 price 이상이면 차단 — 쿠팡이 400 을 준다', () => {
    const r = checkPriceGuards({ price: 48240, apMinSalePrice: 48240, includeVat: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('최저가')
  })

  test('정상이면 통과', () => {
    expect(checkPriceGuards({ price: 48240, apMinSalePrice: 40000, includeVat: true })).toEqual({
      ok: true,
    })
  })
})

test('10원 반올림은 5에서 올린다(half-up) — 돈 경계 고정', () => {
  expect(roundPriceTo10(19_995)).toBe(20_000)
  expect(roundPriceTo10(19_994)).toBe(19_990)
  expect(ceilMinPriceTo10(15_001)).toBe(15_010)
  expect(ceilMinPriceTo10(15_000)).toBe(15_000)
})
