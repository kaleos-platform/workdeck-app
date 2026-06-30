// 세트(번들) 기반 발주·입고 공유 계산 — 순수 함수.
//
// 연동 위치(예: 쿠팡 로켓그로스) 세트는 ProductListing + ProductListingItem(옵션×수량)으로 정의된다.
// 세트 레이어(입력/표시)와 옵션 레이어(예측·재고·INBOUND 단일 진실) 사이를 변환한다.
//   - 세트 수량 → 옵션 수량: decomposeSetsToOptions (Σ over sets of setQty × perSet)
//   - 옵션 발주량 → 세트 제안량: suggestSetQty (병목 = max ceil(optionQty / perSet))
//   - 옵션 재고 → 세트 가용수량: computeSetAvailable (= computeListingAvailableStock 재사용)

import { computeListingAvailableStock } from './listing-calc'

/** 세트 구성 1행 — perSet = ProductListingItem.quantity (세트 1개당 옵션 수량, ≥1). */
export type SetItem = { optionId: string; perSet: number }

/** 세트 수량 입력 1건 — 한 listing(세트)을 setQty개 만든다. */
export type SetQtyInput = { listingId: string; setQty: number; items: SetItem[] }

/**
 * 세트 수량 → 옵션별 필요 수량.
 * 한 옵션이 여러 세트에 속하면 Σ(setQty × perSet)로 합산된다. 0 이하 setQty/perSet은 무시.
 */
export function decomposeSetsToOptions(sets: SetQtyInput[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const set of sets) {
    if (!Number.isFinite(set.setQty) || set.setQty <= 0) continue
    for (const it of set.items) {
      const perSet = Math.max(1, Math.floor(it.perSet))
      const add = Math.floor(set.setQty) * perSet
      if (add <= 0) continue
      out.set(it.optionId, (out.get(it.optionId) ?? 0) + add)
    }
  }
  return out
}

/**
 * 세트 제안 수량 = 구성옵션 발주 필요량의 **병목** = max over items of ceil(optionReorderQty / perSet).
 * 즉 "가장 모자란 구성요소를 채우는 데 필요한 세트 수". 모든 구성옵션 발주량이 0 이하면 0.
 * 세트로 생산하면 비병목 옵션은 과발주될 수 있다(세트 생산의 본질 — 호출부에서 옵션 분해량을 함께 노출).
 */
export function suggestSetQty(items: SetItem[], perOptionReorderQty: Map<string, number>): number {
  let maxSets = 0
  for (const it of items) {
    const perSet = Math.max(1, Math.floor(it.perSet))
    const need = perOptionReorderQty.get(it.optionId) ?? 0
    if (need <= 0) continue
    const sets = Math.ceil(need / perSet)
    if (sets > maxSets) maxSets = sets
  }
  return maxSets
}

/**
 * 세트 가용재고 = min over items of floor(optionStock / perSet) — 만들 수 있는 세트 수.
 * computeListingAvailableStock 재사용(물리 재고 기준). 누락 옵션 재고는 0으로 간주.
 */
export function computeSetAvailable(items: SetItem[], optionStock: Map<string, number>): number {
  return computeListingAvailableStock(
    items.map((it) => ({ quantity: it.perSet, optionStock: optionStock.get(it.optionId) ?? 0 }))
  )
}
