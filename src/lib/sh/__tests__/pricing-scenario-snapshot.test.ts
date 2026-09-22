import {
  parseSnapshot,
  isMeaningfulSnapshot,
  buildRepresentativeSummary,
  type PricingSimSnapshot,
  type PricingSimSnapshotV1,
  type PricingVariant,
} from '@/lib/sh/pricing-scenario-snapshot'

function makeV1Snapshot(): PricingSimSnapshotV1 {
  return {
    v: 1,
    mode: 'existing',
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
      mode: 'existing',
    },
  }
}

function makeV2Snapshot(): PricingSimSnapshot {
  const v1 = makeV1Snapshot()
  const variant: PricingVariant = {
    id: 'v1',
    name: '조합 1',
    mode: v1.mode ?? 'existing',
    rows: v1.rows,
    bundleNameInput: v1.bundleNameInput,
    summary: v1.summary,
  }
  return {
    v: 2,
    live: v1.live,
    selectedChannelIds: v1.selectedChannelIds,
    chOverrides: v1.chOverrides,
    snap: v1.snap,
    activeVariantId: 'v1',
    variants: [variant],
    summary: v1.summary,
  }
}

describe('pricing-scenario-snapshot', () => {
  it('v1 스냅샷을 탭 1개 v2로 변환한다', () => {
    const v1 = makeV1Snapshot()
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(v1)))
    expect(parsed).not.toBeNull()
    expect(parsed!.v).toBe(2)
    expect(parsed!.variants).toHaveLength(1)
    expect(parsed!.activeVariantId).toBe(parsed!.variants[0].id)
    expect(parsed!.variants[0].rows).toEqual(v1.rows)
    expect(parsed!.variants[0].bundleNameInput).toBe(v1.bundleNameInput)
    expect(parsed!.selectedChannelIds).toEqual(v1.selectedChannelIds)
    expect(parsed!.chOverrides).toEqual(v1.chOverrides)
    expect(parsed!.summary).toEqual(v1.summary)
  })

  it('v1 변환 시 bundleNameInput이 없으면 탭 이름은 "조합 1"', () => {
    const v1 = { ...makeV1Snapshot(), bundleNameInput: '' }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(v1)))
    expect(parsed!.variants[0].name).toBe('조합 1')
  })

  it('v1 변환 시 bundleNameInput이 있으면 그 이름을 탭 이름으로 쓴다', () => {
    const v1 = { ...makeV1Snapshot(), bundleNameInput: '벌크 3개' }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(v1)))
    expect(parsed!.variants[0].name).toBe('벌크 3개')
  })

  it('v1의 레거시 전역 promotion을 chPromotions 없을 때 선택 채널 전체에 변환 적용한다', () => {
    const v1 = makeV1Snapshot() // promotion: PERCENT 10, chPromotions 없음
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(v1)))
    expect(parsed!.variants[0].chPromotions).toEqual({
      'ch-1': { type: 'PERCENT', value: 10 },
      'ch-2': { type: 'PERCENT', value: 10 },
    })
  })

  it('v1에 chPromotions가 이미 있으면 그대로 쓰고 전역 promotion은 무시한다', () => {
    const v1: PricingSimSnapshotV1 = {
      ...makeV1Snapshot(),
      chPromotions: { 'ch-1': { type: 'FLAT', value: 2000 } },
      promotion: { type: 'PERCENT', value: 10 },
    }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(v1)))
    expect(parsed!.variants[0].chPromotions).toEqual({ 'ch-1': { type: 'FLAT', value: 2000 } })
  })

  it('v1 promotion이 NONE이면 chPromotions는 undefined', () => {
    const v1: PricingSimSnapshotV1 = { ...makeV1Snapshot(), promotion: { type: 'NONE', value: 0 } }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(v1)))
    expect(parsed!.variants[0].chPromotions).toBeUndefined()
  })

  it('v2 스냅샷이 JSON round-trip으로 보존된다', () => {
    const original = makeV2Snapshot()
    const roundTripped = parseSnapshot(JSON.parse(JSON.stringify(original)))
    expect(roundTripped).toEqual(original)
  })

  it('v2 다중 탭 round-trip', () => {
    const base = makeV2Snapshot()
    const second: PricingVariant = {
      id: 'v2',
      name: '조합 2',
      mode: 'existing',
      rows: [],
      bundleNameInput: '',
      manualPrices: { 'ch-1': 19900 },
      retailOverride: 25000,
      chPromotions: { 'ch-1': { type: 'FLAT', value: 1000 } },
      summary: {
        productNames: ['상품 B'],
        channelCount: 2,
        targetMarginPct: 25,
        priceMin: 10000,
        priceMax: 12000,
        totalCost: 4000,
        mode: 'existing',
      },
    }
    const snapshot: PricingSimSnapshot = {
      ...base,
      activeVariantId: 'v2',
      variants: [base.variants[0], second],
    }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed).toEqual(snapshot)
  })

  it('activeVariantId가 variants에 없으면 첫 탭 id로 폴백', () => {
    const snapshot = { ...makeV2Snapshot(), activeVariantId: 'missing' }
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed!.activeVariantId).toBe(parsed!.variants[0].id)
  })

  it('variants가 빈 배열이면 null', () => {
    const snapshot = { ...makeV2Snapshot(), variants: [] }
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBeNull()
  })

  it('variants 항목에 rows가 배열이 아니면 그 항목을 버리고, 전부 버려지면 null', () => {
    const snapshot = {
      ...makeV2Snapshot(),
      variants: [{ id: 'v1', name: '조합 1', rows: 'not-an-array' }],
    }
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toBeNull()
  })

  it('이상값(버전 없음/형태 어긋남)은 null', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({})).toBeNull()
    expect(parseSnapshot({ v: 3 })).toBeNull()
    expect(parseSnapshot({ v: 2, live: {}, variants: 'x' })).toBeNull()
    expect(parseSnapshot({ v: 2, live: null })).toBeNull()
    expect(parseSnapshot({ v: 1, live: {}, rows: 'x' })).toBeNull()
    expect(parseSnapshot({ v: 1, live: null })).toBeNull()
  })

  it('isMeaningfulSnapshot: 어느 탭에든 상품/채널 있으면 true, 빈 상태 false', () => {
    const s = makeV2Snapshot()
    expect(isMeaningfulSnapshot(s)).toBe(true)
    const empty: PricingSimSnapshot = {
      ...s,
      selectedChannelIds: [],
      variants: [{ ...s.variants[0], rows: [] }],
    }
    expect(isMeaningfulSnapshot(empty)).toBe(false)
  })

  it('buildRepresentativeSummary: productNames 합집합(순서 유지, dedupe)', () => {
    const variants: PricingVariant[] = [
      {
        id: 'a',
        name: '조합 1',
        mode: 'existing',
        rows: [],
        bundleNameInput: '',
        summary: {
          productNames: ['상품 A', '상품 B'],
          channelCount: 2,
          targetMarginPct: 30,
          priceMin: 10000,
          priceMax: 12000,
          totalCost: 5000,
          mode: 'existing',
          retail: 15000,
        },
      },
      {
        id: 'b',
        name: '조합 2',
        mode: 'existing',
        rows: [],
        bundleNameInput: '',
        summary: {
          productNames: ['상품 B', '상품 C'],
          channelCount: 2,
          targetMarginPct: 20,
          priceMin: 8000,
          priceMax: 20000,
          totalCost: 3000,
          mode: 'existing',
          retail: 15000,
        },
      },
    ]
    const summary = buildRepresentativeSummary(variants, { channelCount: 2, targetMarginPct: 30 })
    expect(summary.productNames).toEqual(['상품 A', '상품 B', '상품 C'])
    expect(summary.priceMin).toBe(8000)
    expect(summary.priceMax).toBe(20000)
    expect(summary.totalCost).toBe(5000) // 첫 탭 값
    expect(summary.retail).toBe(15000) // 전 탭 동일
    expect(summary.mode).toBe('existing')
  })

  it('buildRepresentativeSummary: retail 혼재 시 첫 탭 값, mode 혼재 시 existing', () => {
    const variants: PricingVariant[] = [
      {
        id: 'a',
        name: '조합 1',
        mode: 'new',
        rows: [],
        bundleNameInput: '',
        summary: {
          productNames: ['상품 A'],
          channelCount: 1,
          targetMarginPct: 30,
          priceMin: null,
          priceMax: null,
          totalCost: 1000,
          mode: 'new',
          retail: 10000,
        },
      },
      {
        id: 'b',
        name: '조합 2',
        mode: 'existing',
        rows: [],
        bundleNameInput: '',
        summary: {
          productNames: ['상품 B'],
          channelCount: 1,
          targetMarginPct: 30,
          priceMin: null,
          priceMax: null,
          totalCost: 2000,
          mode: 'existing',
          retail: 20000,
        },
      },
    ]
    const summary = buildRepresentativeSummary(variants, { channelCount: 1, targetMarginPct: 30 })
    expect(summary.retail).toBe(10000) // 혼재 → 첫 탭 값
    expect(summary.mode).toBe('existing') // 혼재 → existing
  })
})
