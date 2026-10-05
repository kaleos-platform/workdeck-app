// 쿠팡 Wing(셀러 어드민) 딥링크. sellerProductId = CoupangProductItem.sellerProductId
// (= vendorInventoryId, 실측 확인) 을 그대로 쿼리에 싣는다.
export function wingListingUrl(sellerProductId: string): string {
  return `https://wing.coupang.com/tenants/seller-web/vendor-inventory/modify?vendorInventoryId=${sellerProductId}`
}
