import {
  collectPricingScenarioChannelIds,
  matchPricingScenarioToListingGroup,
} from '@/lib/sh/pricing-scenario-query'
import type { PricingSimSnapshotV1 } from '@/lib/sh/pricing-scenario-snapshot'

// v1 형태 그대로 테스트 — parseSnapshot이 v1→v2 변환 후에도 selectedChannelIds는
// top-level 유지되므로 query.ts 동작은 버전 무관하게 동일해야 한다.
function makeSnapshot(channelIds: string[]): PricingSimSnapshotV1 {
  return {
    v: 1,
    mode: 'existing',
    live: {
      targetMargin: 0.3,
      minMargin: 0.12,
      includeVat: true,
      vatRate: 0.1,
      returnRate: 0,
      returnHandling: 0,
    },
    rows: [
      {
        productId: 'prod-a',
        productName: '상품 A',
        optionId: 'opt-a',
        optionIds: ['opt-a'],
        costPrice: 5000,
        retailPrice: 12000,
        quantity: 1,
      },
    ],
    bundleNameInput: '',
    selectedChannelIds: channelIds,
    chOverrides: {},
    promotion: { type: 'NONE', value: 0 },
    snap: true,
    summary: {
      productNames: ['상품 A'],
      channelCount: channelIds.length,
      targetMarginPct: 30,
      priceMin: 15000,
      priceMax: 15000,
      totalCost: 5000,
    },
  }
}

describe('pricing-scenario-query', () => {
  it('listing group의 상품 집합과 현재 판매채널이 모두 맞는 시나리오만 통과시킨다', () => {
    const target = {
      productIds: ['prod-a', 'prod-b'],
      channelId: 'channel-coupang',
    }

    expect(
      matchPricingScenarioToListingGroup({
        scenarioProductIds: ['prod-a'],
        inputSnapshot: makeSnapshot(['channel-coupang']),
        target,
      })
    ).toBe(true)

    expect(
      matchPricingScenarioToListingGroup({
        scenarioProductIds: ['other-prod'],
        inputSnapshot: makeSnapshot(['channel-coupang']),
        target,
      })
    ).toBe(false)

    expect(
      matchPricingScenarioToListingGroup({
        scenarioProductIds: ['prod-a'],
        inputSnapshot: makeSnapshot(['channel-naver']),
        target,
      })
    ).toBe(false)
  })

  it('v2 스냅샷(variants[])도 selectedChannelIds는 top-level이라 동일하게 매칭된다', () => {
    const target = { productIds: ['prod-a'], channelId: 'channel-coupang' }
    const v2Snapshot = {
      v: 2,
      live: makeSnapshot([]).live,
      selectedChannelIds: ['channel-coupang'],
      chOverrides: {},
      snap: true,
      activeVariantId: 'tab-1',
      variants: [
        {
          id: 'tab-1',
          name: '조합 1',
          mode: 'existing',
          rows: [],
          bundleNameInput: '',
          summary: {
            productNames: [],
            channelCount: 1,
            targetMarginPct: 30,
            priceMin: null,
            priceMax: null,
            totalCost: 0,
          },
        },
      ],
      summary: {
        productNames: [],
        channelCount: 1,
        targetMarginPct: 30,
        priceMin: null,
        priceMax: null,
        totalCost: 0,
      },
    }
    expect(
      matchPricingScenarioToListingGroup({
        scenarioProductIds: ['prod-a'],
        inputSnapshot: v2Snapshot,
        target,
      })
    ).toBe(true)
  })

  it('스냅샷 selectedChannelIds와 레거시 channelId를 채널명 조회용으로 모은다', () => {
    expect(
      collectPricingScenarioChannelIds([
        { channelId: 'legacy-channel', inputSnapshot: makeSnapshot(['channel-a', 'channel-b']) },
        { channelId: null, inputSnapshot: makeSnapshot(['channel-b', 'channel-c']) },
        { channelId: 'legacy-channel', inputSnapshot: null },
      ])
    ).toEqual(['legacy-channel', 'channel-a', 'channel-b', 'channel-c'])
  })
})
