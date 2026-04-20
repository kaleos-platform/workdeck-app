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

// ─── Seller Hub ───────────────────────────────────────────────────────────────
export const SELLER_HUB_DECK_ID = 'seller-hub'
export const SELLER_HUB_BASE_PATH = '/d/seller-hub'
export const SELLER_HUB_HOME_PATH = `${SELLER_HUB_BASE_PATH}/home`
export const SELLER_HUB_SETTINGS_PATH = `${SELLER_HUB_BASE_PATH}/settings`

// 상품 섹션
export const SELLER_HUB_PRODUCTS_LIST_PATH = `${SELLER_HUB_BASE_PATH}/products/list`
export const SELLER_HUB_BRANDS_PATH = `${SELLER_HUB_BASE_PATH}/products/brands`
export const SELLER_HUB_PRICING_SIM_PATH = `${SELLER_HUB_BASE_PATH}/products/pricing-sim`
export const SELLER_HUB_LISTINGS_PATH = `${SELLER_HUB_BASE_PATH}/products/listings`
export function getSellerHubProductPath(id: string) {
  return `${SELLER_HUB_BASE_PATH}/products/${id}`
}

// 재고 섹션
export const SELLER_HUB_STOCK_STATUS_PATH = `${SELLER_HUB_BASE_PATH}/inventory/stock-status`
export const SELLER_HUB_MOVEMENTS_PATH = `${SELLER_HUB_BASE_PATH}/inventory/movements`
export const SELLER_HUB_LOCATIONS_PATH = `${SELLER_HUB_BASE_PATH}/inventory/locations`
export const SELLER_HUB_RECONCILIATION_PATH = `${SELLER_HUB_BASE_PATH}/inventory/reconciliation`
export const SELLER_HUB_REORDER_PATH = `${SELLER_HUB_BASE_PATH}/inventory/reorder`

// 배송 섹션
export const SELLER_HUB_SHIPPING_REGISTRATION_PATH = `${SELLER_HUB_BASE_PATH}/shipping/registration`
export const SELLER_HUB_SHIPPING_ORDERS_PATH = `${SELLER_HUB_BASE_PATH}/shipping/orders`
export const SELLER_HUB_SHIPPING_METHODS_PATH = `${SELLER_HUB_BASE_PATH}/shipping/methods`
export const SELLER_HUB_SHIPPING_INTEGRATION_PATH = `${SELLER_HUB_BASE_PATH}/shipping/integration`

// 채널 섹션
export const SELLER_HUB_CHANNELS_PATH = `${SELLER_HUB_BASE_PATH}/channels`
export const SELLER_HUB_CHANNEL_GROUPS_PATH = `${SELLER_HUB_BASE_PATH}/channels/groups`
export const SELLER_HUB_CHANNEL_FEES_PATH = `${SELLER_HUB_BASE_PATH}/channels/fees`
export function getSellerHubChannelPath(id: string) {
  return `${SELLER_HUB_CHANNELS_PATH}/${id}`
}
