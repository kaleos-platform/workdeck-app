import {
  calculateCTR,
  calculateCVR,
  calculateROAS,
  calculateEngagementRate,
} from '../metrics-calculator'

describe('calculateCTR', () => {
  it('정상 계산: 1000클릭 / 10000노출 = 10.0%', () => {
    expect(calculateCTR(1000, 10000)).toBe(10.0)
  })

  it('소수점 반올림: round2 적용', () => {
    // 333 / 10000 * 100 = 3.33
    expect(calculateCTR(333, 10000)).toBe(3.33)
  })

  it('노출수 0이면 null 반환', () => {
    expect(calculateCTR(0, 0)).toBeNull()
    expect(calculateCTR(100, 0)).toBeNull()
  })

  it('클릭수 0이어도 노출수가 있으면 0 반환', () => {
    expect(calculateCTR(0, 1000)).toBe(0)
  })
})

describe('calculateCVR', () => {
  it('정상 계산: 50주문 / 1000클릭 = 5.0%', () => {
    expect(calculateCVR(50, 1000)).toBe(5.0)
  })

  it('소수점 반올림: round2 적용', () => {
    // 1 / 300 * 100 = 0.333... → 0.33
    expect(calculateCVR(1, 300)).toBe(0.33)
  })

  it('클릭수 0이면 null 반환', () => {
    expect(calculateCVR(0, 0)).toBeNull()
    expect(calculateCVR(10, 0)).toBeNull()
  })

  it('주문수 0이어도 클릭수가 있으면 0 반환', () => {
    expect(calculateCVR(0, 500)).toBe(0)
  })
})

describe('calculateROAS', () => {
  it('정상 계산: 500000매출 / 100000광고비 = 500.0%', () => {
    expect(calculateROAS(500000, 100000)).toBe(500.0)
  })

  it('소수점 반올림: round2 적용', () => {
    // 10000 / 3000 * 100 = 333.333... → 333.33
    expect(calculateROAS(10000, 3000)).toBe(333.33)
  })

  it('광고비 0이면 null 반환', () => {
    expect(calculateROAS(0, 0)).toBeNull()
    expect(calculateROAS(50000, 0)).toBeNull()
  })

  it('매출 0이어도 광고비가 있으면 0 반환', () => {
    expect(calculateROAS(0, 10000)).toBe(0)
  })
})

describe('calculateEngagementRate', () => {
  it('정상 계산: 200참여 / 10000노출 = 2.0%', () => {
    expect(calculateEngagementRate(200, 10000)).toBe(2.0)
  })

  it('소수점 반올림: round2 적용', () => {
    // 1 / 300 * 100 = 0.333... → 0.33
    expect(calculateEngagementRate(1, 300)).toBe(0.33)
  })

  it('노출수 0이면 null 반환', () => {
    expect(calculateEngagementRate(0, 0)).toBeNull()
    expect(calculateEngagementRate(100, 0)).toBeNull()
  })

  it('참여수 0이어도 노출수가 있으면 0 반환', () => {
    expect(calculateEngagementRate(0, 5000)).toBe(0)
  })
})
