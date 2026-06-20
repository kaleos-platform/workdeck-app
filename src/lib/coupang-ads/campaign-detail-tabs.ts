export type CampaignDetailTab = 'dashboard' | 'keywords' | 'products' | 'trends' | 'addata'
export type CampaignDetailResource = 'keywords' | 'products' | 'trends' | 'records'

const RESOURCE_TAB: Record<CampaignDetailResource, CampaignDetailTab> = {
  keywords: 'keywords',
  products: 'products',
  trends: 'trends',
  records: 'addata',
}

export function shouldLoadCampaignTab(
  activeTab: CampaignDetailTab,
  resource: CampaignDetailResource
): boolean {
  return RESOURCE_TAB[resource] === activeTab
}
