import { splitRocketBundle } from '@/lib/inv/rocket-bundle-split'

describe('splitRocketBundle', () => {
  it('수량은 배수, 매출은 보존 배분 — 산식이 다르다', () => {
    const out = splitRocketBundle(10, 30000, [
      { optionId: 'A', quantity: 2 },
      { optionId: 'B', quantity: 1 },
    ])
    expect(out).toEqual([
      { optionId: 'A', quantity: 20, revenue: 20000 },
      { optionId: 'B', quantity: 10, revenue: 10000 },
    ])
    // 매출 합은 투입 매출 그대로 (배수로 부풀지 않는다)
    expect(out.reduce((a, r) => a + r.revenue, 0)).toBe(30000)
  })

  it('1:1 매핑은 그대로 통과', () => {
    expect(splitRocketBundle(7, 12345, [{ optionId: 'A', quantity: 1 }])).toEqual([
      { optionId: 'A', quantity: 7, revenue: 12345 },
    ])
  })

  it('나누어떨어지지 않아도 매출 합이 보존된다', () => {
    const out = splitRocketBundle(1, 10000, [
      { optionId: 'A', quantity: 1 },
      { optionId: 'B', quantity: 1 },
      { optionId: 'C', quantity: 1 },
    ])
    expect(out.reduce((a, r) => a + r.revenue, 0)).toBe(10000)
  })

  it('구성이 없으면 빈 배열', () => {
    expect(splitRocketBundle(10, 30000, [])).toEqual([])
    expect(splitRocketBundle(10, 30000, [{ optionId: 'A', quantity: 0 }])).toEqual([])
  })

  it('매출이 0이어도 수량은 나온다', () => {
    expect(splitRocketBundle(3, 0, [{ optionId: 'A', quantity: 2 }])).toEqual([
      { optionId: 'A', quantity: 6, revenue: 0 },
    ])
  })
})
