/**
 * 상품 API 전체 순회 → 앱 적재.
 * 상품 55개 × 1.3초 스로틀 ≈ 70초. 목록 조회는 businessTypes=rocketGrowth 필수.
 */
import type { CoupangApiClient } from '../coupang-api/client.js'
import {
  fetchSellerProducts,
  fetchSellerProduct,
  extractProductItems,
  type CoupangProductItemRow,
} from '../coupang-api/endpoints.js'
import { upsertProductItems } from '../api-client.js'

export async function runProductSync(
  client: CoupangApiClient,
  vendorId: string,
  spaceId: string
): Promise<{ products: number; rows: number }> {
  const products = await fetchSellerProducts(client, vendorId, {
    businessTypes: 'rocketGrowth',
  })

  const rows: CoupangProductItemRow[] = []
  for (const p of products) {
    try {
      const detail = await fetchSellerProduct(client, p.sellerProductId)
      rows.push(...extractProductItems(detail))
    } catch (err) {
      // 한 상품이 실패해도 나머지를 버리지 않는다. 다음 수집에서 복구된다.
      console.warn(
        `[product-sync] 단건 조회 실패(sellerProductId=${p.sellerProductId}):`,
        err instanceof Error ? err.message : err
      )
    }
  }

  await upsertProductItems(spaceId, rows)
  return { products: products.length, rows: rows.length }
}
