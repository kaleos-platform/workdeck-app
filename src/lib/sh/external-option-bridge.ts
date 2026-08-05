/**
 * 쿠팡 외부 옵션ID → 내부 InvProductOption 브리지.
 *
 * AdRecord.optionId 와 InventoryRecord.optionId 는 같은 쿠팡 외부 옵션ID 공간을 쓰지만
 * (예: "92143176219"), 내부 InvProductOption 과는 FK 가 없다. 유일하게 작동하는 경로는
 * 3-hop 이다:
 *
 *   외부 optionId
 *     → INVENTORY_HEALTH InventoryRecord (optionId·skuId 동시 보유)
 *       → InvLocationProductMap.externalCode = skuId
 *         → InvLocationProductMapItem (optionId, quantity)
 *           → InvProductOption
 *
 * VENDOR_ITEM_METRICS 행은 skuId 가 전부 null 이라 직접 조인이 불가능하고,
 * ChannelProductAlias 는 VENDOR optionName 형식("상품명, 옵션1, 옵션2")과 어긋나
 * 매칭률이 0 이다. (2026-08-05 prod 실측)
 *
 * 한 외부코드가 여러 내부 옵션으로 팬아웃되면 MapItem.quantity 비례로 금액을 나눈다.
 * 단순 조인하면 같은 금액이 옵션 수만큼 중복 계상된다.
 */

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { EMPTY_BRIDGE, type BridgeAllocation, type ExternalOptionBridge } from './external-option-alloc'

export {
  allocateByBridge,
  type BridgeAllocation,
  type ExternalOptionBridge,
} from './external-option-alloc'

/**
 * space 의 외부 옵션 브리지를 구성한다.
 * 로켓 연동이 없거나 매핑이 비어 있으면 빈 브리지를 돌려준다(에러 아님).
 */
export async function loadExternalOptionBridge(
  spaceId: string,
  workspaceId: string
): Promise<ExternalOptionBridge> {
  // 1) 외부 optionId → skuId 사전. INVENTORY_HEALTH 만 두 값을 함께 갖는다.
  const dict = await prisma.inventoryRecord.findMany({
    // optionId 는 non-null 컬럼이라 조건이 필요 없고, skuId 만 nullable 이다.
    where: { workspaceId, skuId: { not: null } },
    select: { optionId: true, skuId: true },
    distinct: ['optionId', 'skuId'],
  })
  if (dict.length === 0) return EMPTY_BRIDGE

  // 2) externalCode(=skuId) → 내부 옵션 매핑.
  //    같은 skuId 가 여러 위치에 매핑될 수 있어 로켓그로스 위치를 우선한다.
  const maps = await prisma.invLocationProductMap.findMany({
    where: { spaceId },
    select: {
      externalCode: true,
      location: { select: { externalSource: true } },
      items: { select: { optionId: true, quantity: true } },
    },
  })

  const allocByExternalCode = new Map<string, { rocket: boolean; items: BridgeAllocation[] }>()
  for (const m of maps) {
    if (m.items.length === 0) continue
    const isRocket = m.location.externalSource === EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH
    const existing = allocByExternalCode.get(m.externalCode)
    // 로켓그로스 위치 매핑이 다른 위치 매핑을 이긴다. 동급이면 먼저 온 것을 유지.
    if (existing && (existing.rocket || !isRocket)) continue

    const total = m.items.reduce((s, it) => s + Math.max(0, it.quantity), 0)
    if (total <= 0) continue
    allocByExternalCode.set(m.externalCode, {
      rocket: isRocket,
      items: m.items
        .filter((it) => it.quantity > 0)
        .map((it) => ({ optionId: it.optionId, weight: it.quantity / total })),
    })
  }
  if (allocByExternalCode.size === 0) {
    return { byExternalOptionId: new Map(), stats: { dictEntries: dict.length, bridgedExternalOptions: 0 } }
  }

  // 3) 두 단계를 합성.
  const byExternalOptionId = new Map<string, BridgeAllocation[]>()
  for (const row of dict) {
    const ext = row.optionId
    const sku = row.skuId
    if (!ext || !sku || byExternalOptionId.has(ext)) continue
    const alloc = allocByExternalCode.get(sku)
    if (alloc) byExternalOptionId.set(ext, alloc.items)
  }

  return {
    byExternalOptionId,
    stats: { dictEntries: dict.length, bridgedExternalOptions: byExternalOptionId.size },
  }
}
