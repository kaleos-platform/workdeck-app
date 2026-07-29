// @jest-environment node
// costExVat — 공급원가 ex-VAT 환산 유닛 테스트 (Phase 2)

import { costExVat, SUPPLY_VAT_RATE } from '../cost'

describe('costExVat', () => {
  it('VAT 미포함(false)이면 입력값 그대로 반환 — 불변식 (a)', () => {
    expect(costExVat(10000, false)).toBe(10000)
    expect(costExVat(5109, false)).toBe(5109)
  })

  it('VAT 포함(true)이면 ÷1.1 — 불변식 (b)', () => {
    expect(costExVat(1100, true)).toBeCloseTo(1000, 6)
    expect(costExVat(11000, true)).toBeCloseTo(10000, 6)
    // 일반값: raw/1.1
    expect(costExVat(1000, true)).toBeCloseTo(1000 / (1 + SUPPLY_VAT_RATE), 6)
  })

  it('null/undefined/빈값은 0', () => {
    expect(costExVat(null, false)).toBe(0)
    expect(costExVat(undefined, true)).toBe(0)
    expect(costExVat(0, true)).toBe(0)
  })

  it('SUPPLY_VAT_RATE = 0.1 (한국 표준)', () => {
    expect(SUPPLY_VAT_RATE).toBe(0.1)
  })

  it('가중 집계 예시: vatIncluded 혼합 항목 → ex-VAT 합', () => {
    // 항목: [1,100,000(포함), 7,040,000(포함), 3,064,600(미포함)]
    const items = [
      { amount: 1_100_000, vatIncluded: true },
      { amount: 7_040_000, vatIncluded: true },
      { amount: 3_064_600, vatIncluded: false },
    ]
    const exVatSum = items.reduce((s, c) => s + costExVat(c.amount, c.vatIncluded), 0)
    // (1,100,000 + 7,040,000)/1.1 + 3,064,600 = 7,400,000 + 3,064,600
    expect(exVatSum).toBeCloseTo(7_400_000 + 3_064_600, 4)
  })
})
