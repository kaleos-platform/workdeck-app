/**
 * API 재고 어댑터 — 로켓창고 재고 요약 전량 조회 후 InventoryApiRow[] 로 변환.
 *
 * productId 는 여기서 채우지 않는다 — 워커는 Prisma 의존이 없어(worker/package.json)
 * optionId->productId 이력 역산을 못 한다. 앱(src/lib/collection/resolve-product-id.ts)이
 * 채운다(계획서 §D/§E, Phase0 실측 부록 확정 규칙).
 */
import { CoupangApiClient } from '../coupang-api/client.js'
import { extractInventoryQuantities, fetchInventorySummaries } from '../coupang-api/endpoints.js'
import type {
  CollectContext,
  CollectPayload,
  InventoryApiRow,
  InventorySourceAdapter,
} from './types.js'

export class InventoryApiAdapter implements InventorySourceAdapter {
  readonly source = 'API' as const

  async collectInventory(ctx: CollectContext): Promise<CollectPayload> {
    if (!ctx.apiCredential) {
      throw new Error(
        '쿠팡 API 자격증명이 없습니다 — inventorySource=API 이지만 apiCredential 미제공'
      )
    }
    const client = new CoupangApiClient(ctx.apiCredential)
    const summaries = await fetchInventorySummaries(client, ctx.apiCredential.vendorId)

    // vendorItemId/externalSkuId 는 API 응답에서 숫자로 온다 — text 컬럼(optionId/skuId)과
    // 비교하려면 문자열 정규화가 필수다(Phase0 실측 §4).
    const rows: InventoryApiRow[] = summaries.map((item) => ({
      optionId: String(item.vendorItemId),
      skuId: item.externalSkuId != null ? String(item.externalSkuId) : null,
      ...extractInventoryQuantities(item),
    }))

    return { kind: 'rows', rows }
  }
}
