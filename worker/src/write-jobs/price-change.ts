/**
 * 가격 변경 잡 — 타깃 순차 PUT.
 *
 * 현재가 조회는 **감사용**이다. 자동 가격조정이 켜진 옵션은 설계상 가격이 수시로
 * 바뀌므로 "미리보기 시점 가격과 다르면 중단"은 틀린 가드다(대부분의 쓰기가 막힌다).
 * 승인자가 결정한 것은 "판매가를 X로, 하한을 Y로"이지 "현재가가 Z일 때만"이 아니다.
 *
 * 부분 실패는 롤백하지 않는다. 성공한 건 성공으로 두고 건별 결과를 남긴다.
 */
import type { CoupangApiClient } from '../coupang-api/client.js'
import { changeVendorItemPrice, fetchVendorItemStatus } from '../coupang-api/endpoints.js'

export type PriceTargetResult = {
  vendorItemId: string
  listingId: string
  observedPrice: number | null
  ok: boolean
  error: string | null
}

type Payload = {
  apActive: boolean
  targets: Array<{
    listingId: string
    vendorItemId: string
    targetPrice: number
    apMinSalePrice: number
  }>
}

export async function runPriceChange(
  client: CoupangApiClient,
  payload: unknown
): Promise<PriceTargetResult[]> {
  const p = payload as Payload
  const results: PriceTargetResult[] = []

  for (const t of p.targets) {
    let observedPrice: number | null = null
    try {
      const status = await fetchVendorItemStatus(client, t.vendorItemId)
      observedPrice = typeof status?.salePrice === 'number' ? status.salePrice : null
    } catch (err) {
      // 조회 실패는 감사 정보 손실일 뿐 쓰기를 막지 않는다.
      console.warn(
        `[price-change] 현재가 조회 실패(vendorItemId=${t.vendorItemId}):`,
        err instanceof Error ? err.message : err
      )
    }

    try {
      await changeVendorItemPrice(client, {
        vendorItemId: t.vendorItemId,
        price: t.targetPrice,
        apActive: p.apActive,
        apMinSalePrice: t.apMinSalePrice,
      })
      results.push({
        vendorItemId: t.vendorItemId,
        listingId: t.listingId,
        observedPrice,
        ok: true,
        error: null,
      })
    } catch (err) {
      results.push({
        vendorItemId: t.vendorItemId,
        listingId: t.listingId,
        observedPrice,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
