// @jest-environment node
// calculatePricing — 프로모션 반영 유닛 테스트 (Fix 3)

import { calculatePricing } from '../pricing-calc'

// ─── 공통 기본 입력 ──────────────────────────────────────────────────────────

const base = {
  costPrice: 5000,
  salePrice: 20000,
  discountRate: 0,       // 컬럼 할인 없음
  channelFeePct: 0.1,    // 10%
  shippingCost: 0,
  packagingCost: 500,
  adCostPct: 0,
  operatingCostPct: 0,
  includeVat: false,
  vatRate: 0.1,
}

// ─── 프로모션 없음 — 기존 동작과 동일해야 함 ────────────────────────────────

test('promotion=undefined → 기존 결과와 동일', () => {
  const withoutPromo = calculatePricing(base)
  const withNonePromo = calculatePricing({ ...base, promotion: { type: 'NONE', value: 0 } })

  expect(withNonePromo.finalPrice).toBe(withoutPromo.finalPrice)
  expect(withNonePromo.netProfit).toBe(withoutPromo.netProfit)
  expect(withNonePromo.margin).toBe(withoutPromo.margin)
})

// ─── PERCENT 프로모션 ────────────────────────────────────────────────────────
// salePrice=20000, discountRate=0 → priceAfterDiscount=20000
// PERCENT 10% (value=0.1) → finalPrice = 20000 * (1-0.1) = 18000
// revenueExVat = 18000 (includeVat=false)
// channelFee = 18000 * 0.1 = 1800
// totalCost = 5000 + 1800 + 0 + 500 + 0 + 0 = 7300
// netProfit = 18000 - 7300 = 10700
// margin = 10700 / 18000 ≈ 0.5944

test('PERCENT 10% → finalPrice=18000, margin 올바름', () => {
  const result = calculatePricing({
    ...base,
    promotion: { type: 'PERCENT', value: 0.1 }, // UI 10% → /100 → 0.1
  })
  expect(result.finalPrice).toBe(18000)
  expect(result.netProfit).toBe(10700)
  expect(result.margin).toBeCloseTo(10700 / 18000, 3)
})

// ─── FLAT 프로모션 ───────────────────────────────────────────────────────────
// priceAfterDiscount=20000, FLAT 2000 → finalPrice=18000
// 이후 PERCENT 예시와 동일 숫자이므로 netProfit/margin도 같음

test('FLAT 2000원 → finalPrice=18000', () => {
  const result = calculatePricing({
    ...base,
    promotion: { type: 'FLAT', value: 2000 },
  })
  expect(result.finalPrice).toBe(18000)
  expect(result.netProfit).toBe(10700)
})

// ─── MIN_PRICE 프로모션 ─────────────────────────────────────────────────────
// priceAfterDiscount=20000, MIN_PRICE ceiling=15000 → finalPrice=15000
// revenueExVat=15000, channelFee=1500, totalCost=5000+1500+500=7000
// netProfit=15000-7000=8000, margin=8000/15000≈0.5333

test('MIN_PRICE 15000 → finalPrice=15000', () => {
  const result = calculatePricing({
    ...base,
    promotion: { type: 'MIN_PRICE', value: 15000 },
  })
  expect(result.finalPrice).toBe(15000)
  expect(result.netProfit).toBe(8000)
})

// ─── MIN_PRICE가 현재 가격보다 높으면 영향 없음 ─────────────────────────────
// ceiling=25000 > 20000 → Math.min(20000, 25000)=20000

test('MIN_PRICE ceiling이 현재가보다 높으면 영향 없음', () => {
  const withoutPromo = calculatePricing(base)
  const result = calculatePricing({
    ...base,
    promotion: { type: 'MIN_PRICE', value: 25000 },
  })
  expect(result.finalPrice).toBe(withoutPromo.finalPrice)
})

// ─── 음수 클램프 ─────────────────────────────────────────────────────────────

test('FLAT이 가격을 초과해도 finalPrice는 0 이상', () => {
  const result = calculatePricing({
    ...base,
    promotion: { type: 'FLAT', value: 99999 },
  })
  expect(result.finalPrice).toBeGreaterThanOrEqual(0)
})
