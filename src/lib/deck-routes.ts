export const COUPANG_ADS_DECK_ID = 'coupang-ads'
export const COUPANG_ADS_BASE_PATH = '/d/coupang-ads'
export const COUPANG_ADS_UPLOAD_PATH = `${COUPANG_ADS_BASE_PATH}/upload`
export const COUPANG_ADS_ANALYSIS_PATH = `${COUPANG_ADS_BASE_PATH}/analysis`
export const COUPANG_ADS_EXECUTION_PATH = `${COUPANG_ADS_BASE_PATH}/execution`
export const COUPANG_ADS_SETTINGS_PATH = `${COUPANG_ADS_BASE_PATH}/settings`
export const COUPANG_ADS_INVENTORY_PATH = `${COUPANG_ADS_BASE_PATH}/inventory`

export function getCoupangAdsCampaignPath(campaignId: string): string {
  return `${COUPANG_ADS_BASE_PATH}/campaigns/${campaignId}`
}
