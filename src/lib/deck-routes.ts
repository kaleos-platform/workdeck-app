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
export const SELLER_HUB_SALES_ANALYTICS_PATH = `${SELLER_HUB_BASE_PATH}/sales-analytics`
export const SELLER_HUB_SETTINGS_PATH = `${SELLER_HUB_BASE_PATH}/settings`

// 상품 섹션
export const SELLER_HUB_PRODUCTS_LIST_PATH = `${SELLER_HUB_BASE_PATH}/products/list`
export const SELLER_HUB_PRODUCT_NEW_PATH = `${SELLER_HUB_BASE_PATH}/products/new`
export const SELLER_HUB_BRANDS_PATH = `${SELLER_HUB_BASE_PATH}/settings/brands`
export const SELLER_HUB_PRICING_SIM_PATH = `${SELLER_HUB_BASE_PATH}/products/pricing-sim`
export const SELLER_HUB_LISTINGS_PATH = `${SELLER_HUB_BASE_PATH}/products/listings`
export const SELLER_HUB_LISTING_NEW_PATH = `${SELLER_HUB_BASE_PATH}/products/listings/new`
export const SELLER_HUB_PRODUCTION_PATH = `${SELLER_HUB_BASE_PATH}/products/production`
export function getSellerHubProductPath(id: string) {
  return `${SELLER_HUB_BASE_PATH}/products/${id}`
}
export function getSellerHubListingPath(id: string) {
  return `${SELLER_HUB_BASE_PATH}/products/listings/${id}`
}
export function getSellerHubChannelProductPath(channelProductId: string) {
  return `${SELLER_HUB_BASE_PATH}/products/listings/groups/${channelProductId}`
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

// 설정 섹션 — 데이터 연동 (다른 Deck·외부 데이터 연동 설정 허브)
export const SELLER_HUB_SETTINGS_INTEGRATION_PATH = `${SELLER_HUB_BASE_PATH}/settings/integration`
/** @deprecated `SELLER_HUB_SETTINGS_INTEGRATION_PATH` 사용. 구 URL 리다이렉트 호환용으로만 유지. */
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

// 통합 설정 섹션 (PR-A: 평탄화 재구성)
export const SALES_CONTENT_SETTINGS_PATH = `${SALES_CONTENT_BASE_PATH}/settings`

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

// ─── 블로그 운영 (Blog Ops) ───────────────────────────────────────────────────
export const BLOG_OPS_DECK_ID = 'blog-ops'
export const BLOG_OPS_BASE_PATH = '/d/blog-ops'
export const BLOG_OPS_HOME_PATH = `${BLOG_OPS_BASE_PATH}/home`
export const BLOG_OPS_PRODUCTS_PATH = `${BLOG_OPS_BASE_PATH}/products`
export const BLOG_OPS_IDEATION_PATH = `${BLOG_OPS_BASE_PATH}/ideation`
export const BLOG_OPS_MATERIALS_PATH = `${BLOG_OPS_BASE_PATH}/materials`
export const BLOG_OPS_POSTS_PATH = `${BLOG_OPS_BASE_PATH}/posts`
export const BLOG_OPS_CHANNELS_PATH = `${BLOG_OPS_BASE_PATH}/channels`
export const BLOG_OPS_DEPLOYMENTS_PATH = `${BLOG_OPS_BASE_PATH}/deployments`

export function getBlogOpsPostPath(id: string): string {
  return `${BLOG_OPS_POSTS_PATH}/${id}`
}

export function getBlogOpsDeploymentPath(id: string): string {
  return `${BLOG_OPS_DEPLOYMENTS_PATH}/${id}`
}

// ─── 재무 관리 (Finance) ───────────────────────────────────────────────────────
export const FINANCE_DECK_ID = 'finance'
export const FINANCE_BASE_PATH = '/d/finance'
export const FINANCE_DASHBOARD_PATH = `${FINANCE_BASE_PATH}/dashboard`
export const FINANCE_CASHFLOW_PATH = `${FINANCE_BASE_PATH}/cashflow`
export const FINANCE_TRANSACTIONS_PATH = `${FINANCE_BASE_PATH}/transactions`
export const FINANCE_UPLOAD_PATH = `${FINANCE_BASE_PATH}/upload`
export const FINANCE_ACCOUNTS_PATH = `${FINANCE_BASE_PATH}/accounts`
export const FINANCE_BALANCES_PATH = `${FINANCE_BASE_PATH}/balances`

// ─── 채용 관리 ① 공고 제작 (Hiring Posts) ─────────────────────────────────────
export const HIRING_POSTS_DECK_ID = 'hiring-posts'
export const HIRING_POSTS_BASE_PATH = '/d/hiring-posts'
export const HIRING_POSTS_HOME_PATH = `${HIRING_POSTS_BASE_PATH}/home`
export const HIRING_POSTS_POSTINGS_PATH = `${HIRING_POSTS_BASE_PATH}/postings`
export const HIRING_POSTS_TEMPLATES_PATH = `${HIRING_POSTS_BASE_PATH}/templates`
export const HIRING_POSTS_STORES_PATH = `${HIRING_POSTS_BASE_PATH}/settings/stores`
export const HIRING_POSTS_POSITIONS_PATH = `${HIRING_POSTS_BASE_PATH}/settings/positions`

export function getHiringPostingPath(id: string): string {
  return `${HIRING_POSTS_POSTINGS_PATH}/${id}`
}

export function getHiringPostingBuildPath(id: string, step?: string): string {
  const base = `${HIRING_POSTS_POSTINGS_PATH}/${id}/build`
  return step ? `${base}/${step}` : base
}

// ─── 채용 관리 ② 지원자 관리 (Hiring Applicants) ──────────────────────────────
export const HIRING_APPLICANTS_DECK_ID = 'hiring-applicants'
export const HIRING_APPLICANTS_BASE_PATH = '/d/hiring-applicants'
export const HIRING_APPLICANTS_HOME_PATH = `${HIRING_APPLICANTS_BASE_PATH}/home`
export const HIRING_APPLICANTS_LIST_PATH = `${HIRING_APPLICANTS_BASE_PATH}/applications`
export const HIRING_APPLICANTS_BLACKLIST_PATH = `${HIRING_APPLICANTS_BASE_PATH}/blacklist`
export const HIRING_APPLICANTS_TEMPLATES_PATH = `${HIRING_APPLICANTS_BASE_PATH}/message-templates`

export function getHiringApplicationPath(id: string): string {
  return `${HIRING_APPLICANTS_LIST_PATH}/${id}`
}

// ─── 채용 공개 (무인증) ────────────────────────────────────────────────────────
export function getHiringPublicPostingPath(uuid: string): string {
  return `/p/${uuid}`
}

export function getHiringPublicApplyPath(uuid: string): string {
  return `/p/${uuid}/apply`
}
