/**
 * API 재고 어댑터 — 로켓창고 재고 요약 전량 조회 후 InventoryApiRow[] 로 변환.
 * 이번 턴엔 적재 경로가 없어 CollectPayload.kind='rows' 로만 반환하고,
 * 호출자(orchestrator)가 InventoryRecord 에 쓰지 않고 JSON 덤프만 한다(계획서 §2-5/§2-6).
 */
import { CoupangApiClient } from '../coupang-api/client.js'
import { fetchInventorySummaries } from '../coupang-api/endpoints.js'
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

    const rows: InventoryApiRow[] = summaries.map((item) => ({
      vendorItemId: String(item.vendorItemId),
      externalSkuId: item.externalSkuId ?? null,
      orderableQuantity: item.totalOrderableQuantity ?? null,
      salesQty30d: item.SALES_COUNT_LAST_THIRTY_DAYS ?? null,
    }))

    return { kind: 'rows', rows }
  }
}
