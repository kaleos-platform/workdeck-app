import {
  collectPricingScenarioChannelIds,
  matchPricingScenarioToListingGroup,
} from '@/lib/sh/pricing-scenario-query'
import type { PricingSimSnapshot } from '@/lib/sh/pricing-scenario-snapshot'

function makeSnapshot(channelIds: string[]): PricingSimSnapshot {
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
