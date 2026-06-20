import { shouldLoadCampaignTab } from '@/lib/coupang-ads/campaign-detail-tabs'

describe('shouldLoadCampaignTab', () => {
  test.each([
    ['dashboard', 'records'],
    ['dashboard', 'keywords'],
    ['keywords', 'records'],
    ['addata', 'keywords'],
  ] as const)('%s 탭에서는 %s 데이터를 미리 불러오지 않는다', (activeTab, resource) => {
    expect(shouldLoadCampaignTab(activeTab, resource)).toBe(false)
  })

  test.each([
    ['addata', 'records'],
    ['keywords', 'keywords'],
    ['products', 'products'],
    ['trends', 'trends'],
  ] as const)('%s 탭에서는 %s 데이터만 불러온다', (activeTab, resource) => {
    expect(shouldLoadCampaignTab(activeTab, resource)).toBe(true)
  })
})
