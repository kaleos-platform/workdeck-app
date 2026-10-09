/**
 * 가격 변경 잡 — 타깃 순차 PUT.
 *
 * 현재가 조회는 **감사용**이다. 자동 가격조정이 켜진 옵션은 설계상 가격이 수시로
 * 바뀌므로 "미리보기 시점 가격과 다르면 중단"은 틀린 가드다(대부분의 쓰기가 막힌다).
 * 승인자가 결정한 것은 "판매가를 X로, 하한을 Y로"이지 "현재가가 Z일 때만"이 아니다.
 *
 * 부분 실패는 롤백하지 않는다. 성공한 건 성공으로 두고 건별 결과를 남긴다.
 */
import { CoupangApiError, type CoupangApiClient } from '../coupang-api/client.js'
import { changeVendorItemPrice, fetchVendorItemStatus } from '../coupang-api/endpoints.js'
import { CoupangWriteError } from '../coupang-api/write-result.js'

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

  for (const [i, t] of p.targets.entries()) {
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
      // 응답 해석이 실패여도 실제로는 반영됐을 수 있다(2026-10-09: 성공 응답을 실패로 오판).
      // 쓰기 후 현재가를 다시 읽어 목표가와 같으면 성공으로 확정한다 — 사실이 응답 해석보다 우선.
      if (err instanceof CoupangWriteError) {
        console.warn(
          `[price-change] 쓰기 응답 실패 판정(vendorItemId=${t.vendorItemId}): ${err.coupangMessage} raw=${err.rawBody ?? ''}`
        )
        const after = await fetchVendorItemStatus(client, t.vendorItemId).catch(() => null)
        if (after && after.salePrice === t.targetPrice) {
          console.warn(
            `[price-change] 재조회 결과 반영 확인 — 성공으로 처리(vendorItemId=${t.vendorItemId}, ${after.salePrice})`
          )
          results.push({
            vendorItemId: t.vendorItemId,
            listingId: t.listingId,
            observedPrice,
            ok: true,
            error: null,
          })
          continue
        }
      }
      results.push({
        vendorItemId: t.vendorItemId,
        listingId: t.listingId,
        observedPrice,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      // IP 거부는 이 타깃만의 문제가 아니라 전 스코프가 동시에 죽은 상황이다.
      // 남은 타깃도 전부 같은 이유로 실패하므로 루프를 끊는다. 시도하지 않은 타깃도
      // ok:false 로 남긴다 — 빼면 "1건 중 1건 실패"가 되어 알림의 건수가 거짓이 된다.
      if (err instanceof CoupangApiError && err.reason === 'IP_REJECTED') {
        for (const rest of p.targets.slice(i + 1)) {
          results.push({
            vendorItemId: rest.vendorItemId,
            listingId: rest.listingId,
            observedPrice: null,
            ok: false,
            error: 'IP 거부로 중단 — 시도하지 않음',
          })
        }
        break
      }
    }
  }

  return results
}
