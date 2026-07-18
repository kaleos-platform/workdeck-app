import {
  parseSnapshot,
  isMeaningfulSnapshot,
  type PricingSimSnapshot,
} from '@/lib/sh/pricing-scenario-snapshot'

function makeSnapshot(): PricingSimSnapshot {
  return {
    v: 1,
    live: {
      targetMargin: 0.3,
      minMargin: 0.12,
      includeVat: true,
      vatRate: 0.1,
      returnRate: 0.15,
      returnHandling: 6000,
    },
    rows: [
      {
        productId: 'prod-1',
        productName: '상품 A',
        optionId: 'opt-1',
        optionIds: ['opt-1', 'opt-2'],
        costPrice: 5000,
        retailPrice: 12000,
        quantity: 1,
      },
    ],
    bundleNameInput: '',
    selectedChannelIds: ['ch-1', 'ch-2'],
    chOverrides: {
      'ch-1': {
        feePct: 10.8,
        shippingFeeType: 'FIXED',
        shippingFee: 3000,
        shippingFeePct: 0,
        paymentFeeIncluded: false,
        paymentFeePct: 0.02,
        applyAdCost: true,
        adPct: 0.08,
      },
    },
    promotion: { type: 'PERCENT', value: 10 },
    snap: true,
    summary: {
      productNames: ['상품 A'],
      channelCount: 2,
      targetMarginPct: 30,
      priceMin: 15900,
      priceMax: 18900,
      totalCost: 5000,
    },
  }
}

describe('pricing-scenario-snapshot', () => {
  it('JSON round-trip으로 스냅샷이 보존된다', () => {
    const original = makeSnapshot()
    const roundTripped = parseSnapshot(JSON.parse(JSON.stringify(original)))
    expect(roundTripped).toEqual(original)
  })

  it('버전이 다르거나 형태가 어긋나면 null', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({})).toBeNull()
    expect(parseSnapshot({ v: 2 })).toBeNull()
    expect(parseSnapshot({ v: 1, live: {}, rows: 'x' })).toBeNull()
    expect(parseSnapshot({ v: 1, live: null })).toBeNull()
  })

  it('summary 누락 시 기본 요약으로 채운다', () => {
    const s = makeSnapshot()
    const raw = JSON.parse(JSON.stringify(s)) as Record<string, unknown>
    delete raw.summary
    const parsed = parseSnapshot(raw)
    expect(parsed).not.toBeNull()
    expect(parsed!.summary).toEqual({
      productNames: [],
      channelCount: 0,
      targetMarginPct: 0,
      priceMin: null,
      priceMax: null,
      totalCost: 0,
    })
  })

  it('isMeaningfulSnapshot: 상품/채널 있으면 true, 빈 상태 false', () => {
    const s = makeSnapshot()
    expect(isMeaningfulSnapshot(s)).toBe(true)
    const empty: PricingSimSnapshot = { ...s, rows: [], selectedChannelIds: [] }
    expect(isMeaningfulSnapshot(empty)).toBe(false)
  })
})
