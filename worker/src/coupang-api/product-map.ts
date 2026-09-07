/**
 * productId/productName/optionName 미해결 optionId(vendorItemId) 를 상품 API 로
 * 보강한다(계획서 §D/§E, Phase0 실측 부록, team-lead 반려 후 productName·optionName 도
 * 이력 역산과 동일하게 상품 API 에서 뽑도록 확장).
 *
 * 앱(resolveOptionIdentity)이 InventoryRecord 이력으로 먼저 채우고, 그래도 남는 옵션이
 * 있을 때만 호출자가 이 함수를 부른다. 정상 상태(신규 옵션 없음)에서는 호출 0회다.
 *
 * 상품 목록 API(businessTypes=rocketGrowth)는 sellerProductId 만 주고, vendorItemId/
 * itemName 은 단건 조회(items[].rocketGrowthItemData.vendorItemId 등)에만 있어
 * 목록→단건 순회가 필요하다 — 55개 상품이면 1.3초 스로틀 × 55 ≈ 70초.
 */
import type { CoupangApiClient } from './client.js'
import { fetchSellerProducts, fetchSellerProduct, extractOptionIdentities } from './endpoints.js'

export type ApiOptionIdentity = {
  productId: string
  productName: string | null
  optionName: string | null
}

/**
 * 상품 목록(rocketGrowth) 전체를 순회해
 * optionId(vendorItemId) -> {productId, productName, optionName} 맵을 만든다.
 */
export async function buildApiProductMap(
  client: CoupangApiClient,
  vendorId: string
): Promise<Record<string, ApiOptionIdentity>> {
  const products = await fetchSellerProducts(client, vendorId, { businessTypes: 'rocketGrowth' })
  const map: Record<string, ApiOptionIdentity> = {}

  for (const product of products) {
    try {
      const detail = await fetchSellerProduct(client, product.sellerProductId)
      const productId = String(product.sellerProductId)
      const productName =
        (typeof detail.sellerProductName === 'string' && detail.sellerProductName) ||
        product.sellerProductName ||
        null
      const identities = extractOptionIdentities(detail)
      for (const { optionId, optionName } of identities) {
        map[optionId] = { productId, productName, optionName }
      }
    } catch (err) {
      console.warn(
        `[coupang-api] 상품 단건 조회 실패(sellerProductId=${product.sellerProductId}) — 건너뜀:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  return map
}
