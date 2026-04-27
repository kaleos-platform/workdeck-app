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

// ─── Seller Hub ───────────────────────────────────────────────────────────────
export const SELLER_HUB_DECK_ID = 'seller-hub'
export const SELLER_HUB_BASE_PATH = '/d/seller-ops'
export const SELLER_HUB_HOME_PATH = `${SELLER_HUB_BASE_PATH}/home`
export const SELLER_HUB_SETTINGS_PATH = `${SELLER_HUB_BASE_PATH}/settings`

// 상품 섹션
export const SELLER_HUB_PRODUCTS_LIST_PATH = `${SELLER_HUB_BASE_PATH}/products/list`
export const SELLER_HUB_BRANDS_PATH = `${SELLER_HUB_BASE_PATH}/products/brands`
export const SELLER_HUB_PRICING_SIM_PATH = `${SELLER_HUB_BASE_PATH}/products/pricing-sim`
export const SELLER_HUB_LISTINGS_PATH = `${SELLER_HUB_BASE_PATH}/products/listings`
export const SELLER_HUB_LISTING_NEW_PATH = `${SELLER_HUB_BASE_PATH}/products/listings/new`
export const SELLER_HUB_PRODUCTION_PATH = `${SELLER_HUB_BASE_PATH}/products/production`
export function getSellerHubProductionRunPath(runId: string) {
  return `${SELLER_HUB_PRODUCTION_PATH}/${runId}`
}
export function getSellerHubProductPath(id: string) {
  return `${SELLER_HUB_BASE_PATH}/products/${id}`
}
export function getSellerHubListingPath(id: string) {
  return `${SELLER_HUB_BASE_PATH}/products/listings/${id}`
}
export function getSellerHubListingGroupPath(productId: string, channelId: string) {
  return `${SELLER_HUB_BASE_PATH}/products/listings/groups/${productId}/${channelId}`
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

// ─── Sales Content (B2B 마케팅) ───────────────────────────────────────────────
export const SALES_CONTENT_DECK_ID = 'sales-content'
export const SALES_CONTENT_BASE_PATH = '/d/sales-content'
export const SALES_CONTENT_HOME_PATH = `${SALES_CONTENT_BASE_PATH}/home`

// 정보 세팅 섹션
export const SALES_CONTENT_PRODUCTS_PATH = `${SALES_CONTENT_BASE_PATH}/settings/products`
export const SALES_CONTENT_PERSONAS_PATH = `${SALES_CONTENT_BASE_PATH}/settings/personas`
export const SALES_CONTENT_BRAND_PROFILE_PATH = `${SALES_CONTENT_BASE_PATH}/settings/brand-profile`

// 제작 섹션
export const SALES_CONTENT_IDEATION_PATH = `${SALES_CONTENT_BASE_PATH}/ideation`
export const SALES_CONTENT_CONTENTS_PATH = `${SALES_CONTENT_BASE_PATH}/contents`
export const SALES_CONTENT_TEMPLATES_PATH = `${SALES_CONTENT_BASE_PATH}/templates`

// 배포 섹션
export const SALES_CONTENT_CHANNELS_PATH = `${SALES_CONTENT_BASE_PATH}/channels`
export const SALES_CONTENT_DEPLOYMENTS_PATH = `${SALES_CONTENT_BASE_PATH}/deployments`

// 성과·규칙 섹션
export const SALES_CONTENT_ANALYTICS_PATH = `${SALES_CONTENT_BASE_PATH}/analytics`
export const SALES_CONTENT_RULES_PATH = `${SALES_CONTENT_BASE_PATH}/rules`

export function getSalesContentIdeationPath(id: string): string {
  return `${SALES_CONTENT_IDEATION_PATH}/${id}`
}

export function getSalesContentContentPath(id: string): string {
  return `${SALES_CONTENT_CONTENTS_PATH}/${id}`
}

export function getSalesContentDeploymentPath(id: string): string {
  return `${SALES_CONTENT_DEPLOYMENTS_PATH}/${id}`
}

export function getSalesContentAnalyticsPath(deploymentId: string): string {
  return `${SALES_CONTENT_ANALYTICS_PATH}/${deploymentId}`
}
