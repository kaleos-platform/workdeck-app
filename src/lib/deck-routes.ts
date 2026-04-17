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

export const INVENTORY_MGMT_DECK_ID = 'inventory-mgmt'
export const INVENTORY_MGMT_BASE_PATH = '/d/inventory-mgmt'
export const INVENTORY_MGMT_MOVEMENTS_PATH = `${INVENTORY_MGMT_BASE_PATH}/movements`
export const INVENTORY_MGMT_PRODUCTS_PATH = `${INVENTORY_MGMT_BASE_PATH}/products`
export const INVENTORY_MGMT_LOCATIONS_PATH = `${INVENTORY_MGMT_BASE_PATH}/locations`
export const INVENTORY_MGMT_CHANNELS_PATH = `${INVENTORY_MGMT_BASE_PATH}/channels`
export const INVENTORY_MGMT_RECONCILIATION_PATH = `${INVENTORY_MGMT_BASE_PATH}/reconciliation`
export const INVENTORY_MGMT_REORDER_PATH = `${INVENTORY_MGMT_BASE_PATH}/reorder`
export const INVENTORY_MGMT_SETTINGS_PATH = `${INVENTORY_MGMT_BASE_PATH}/settings`
export const INVENTORY_MGMT_STOCK_STATUS_PATH = `${INVENTORY_MGMT_BASE_PATH}/stock-status`
export const INVENTORY_MGMT_DASHBOARD_PATH = `${INVENTORY_MGMT_BASE_PATH}/dashboard`

export const DELIVERY_MGMT_DECK_ID = 'delivery-mgmt'
export const DELIVERY_MGMT_BASE_PATH = '/d/delivery-mgmt'
export const DELIVERY_MGMT_REGISTRATION_PATH = `${DELIVERY_MGMT_BASE_PATH}/registration`
export const DELIVERY_MGMT_ORDERS_PATH = `${DELIVERY_MGMT_BASE_PATH}/orders`
export const DELIVERY_MGMT_INTEGRATION_PATH = `${DELIVERY_MGMT_BASE_PATH}/integration`
export const DELIVERY_MGMT_CHANNELS_PATH = `${DELIVERY_MGMT_BASE_PATH}/channels`
export const DELIVERY_MGMT_SHIPPING_PATH = `${DELIVERY_MGMT_BASE_PATH}/shipping`
