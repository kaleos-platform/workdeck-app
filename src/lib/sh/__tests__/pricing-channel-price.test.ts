// @jest-environment node
// 채널가 단일 계산(computeChannelPrice) — 카드·KPI·조합 표 공용 규칙 고정

import { computeChannelPrice, type ChannelPriceInput } from '../pricing-channel-price'

const base: ChannelPriceInput = {
  bundle: {
    components: [{ costPrice: 10000, retailPrice: 30000, quantity: 1 }],
    packagingCost: 0,
    salePrice: 0,
  },
  channel: {
    channelType: 'OPEN_MARKET',
    feeRates: [{ categoryName: '기본', ratePercent: 10 }],
    paymentFeeIncluded: true,
    paymentFeePct: 0,
    applyAdCost: true,
    shippingFee: 0,
    freeShippingThreshold: null,
  },
  promotion: { type: 'NONE', value: 0 },
  globals: {
    includeVat: true,
    vatRate: 0.1,
    adCostPct: 0.2,
    operatingCostPct: 0,
    applyReturnAdjustment: false,
    expectedReturnRate: 0,
    returnHandlingCost: 0,
    minimumAcceptableMargin: 0.1,
  },
  thresholds: { platformTargetGood: 0.25, platformTargetFair: 0.15 },
  snap: true,
  retailCap: null,
  manualPrice: null,
}

describe('computeChannelPrice', () => {
  it('권장가는 광고 제외 역산 + …900 스냅, 헤드라인은 그 가격', () => {
    const r = computeChannelPrice(base)
    expect(r.recommended).not.toBeNull()
    expect(r.recommended! % 1000).toBe(900)
    expect(r.effectivePrice).toBe(r.recommended)
    expect(r.headline!.cells[0].finalPrice).toBe(r.effectivePrice)
    // 광고 제외 역산 — 광고 on/off와 무관하게 권장가 동일, 마진만 광고 반영
    const noAd = computeChannelPrice({ ...base, channel: { ...base.channel, applyAdCost: false } })
    expect(noAd.recommended).toBe(r.recommended)
    expect(r.headline!.cells[0].margin).toBeLessThan(noAd.headline!.cells[0].margin)
  })

  it('권장가·수동가 모두 소비자가 상한으로 클램프', () => {
    const auto = computeChannelPrice({ ...base, retailCap: 15000 })
    expect(auto.exceedsRetail).toBe(true)
    expect(auto.effectivePrice).toBe(15000)
    const manual = computeChannelPrice({ ...base, retailCap: 15000, manualPrice: 20000 })
    expect(manual.effectivePrice).toBe(15000)
    const under = computeChannelPrice({ ...base, retailCap: 30000, manualPrice: 18000 })
    expect(under.effectivePrice).toBe(18000)
  })

  it('프로모션 NONE이면 promo=null, 정률이면 적용가가 낮아진다', () => {
    expect(computeChannelPrice(base).promo).toBeNull()
    const r = computeChannelPrice({
      ...base,
      manualPrice: 20000,
      promotion: { type: 'PERCENT', value: 0.1 },
    })
    expect(r.promo!.cells[0].finalPrice).toBe(18000)
  })
})
