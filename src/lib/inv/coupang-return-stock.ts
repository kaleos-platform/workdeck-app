// 쿠팡 로켓그로스 반품 등급 재고를 내부 옵션 단위로 환산한다.
//
// 배경: 쿠팡은 고객 반품품을 등급 매겨 별도 상품으로 재등록한다(productId·optionId·
// skuId 전부 신규 발급). 그 재고는 반품 전용 리스팅에서만 팔려 정상 상품 수요를
// 메우지 못한다.
//
// 정책(사용자 결정):
//  - 재고 현황 = 반품 **포함** (실물이 창고에 있으므로 총량은 맞다)
//  - 발주 계획 = 반품 **제외** (가용재고로 세면 발주가 과소 산출된다)
//
// 저장하지 않는 **파생값**이다. InvStockLevel 같은 원장이 아니므로 호출측은 반드시
// snapshotDate 를 함께 노출해 사용자가 어느 시점 기준인지 알 수 있게 한다.
import { prisma } from '@/lib/prisma'
import { isReturnGrade } from './product-grade'
import { resolveCoupangWorkspaceForSpace } from './resolve-coupang-workspace'

export type CoupangReturnStock = {
  locationId: string
  snapshotDate: Date
  /** optionId → 반품 등급 재고(세트 비율 환산 후 낱개 수량) */
  byOption: Map<string, number>
}

/**
 * Space 의 로켓그로스 최신 스냅샷에서 반품 등급 재고를 옵션별로 집계한다.
 * 쿠팡 미연동이거나 쓸 만한 스냅샷이 없으면 null — 호출측은 차감/표시를 건너뛴다.
 *
 * 주의: 등급은 크롤링 수집분에만 들어온다. Open API 수집분은 productGrade 가 비어
 * 있어 전부 정상으로 취급된다. 향후 API 가 재고를 채우기 시작하면 등급 없는
 * 스냅샷이 선택돼 **반품 차감이 조용히 사라질 수 있다**.
 */
export async function getCoupangReturnStockByOption(
  spaceId: string
): Promise<CoupangReturnStock | null> {
  const resolved = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!resolved) return null

  // 재고가 채워진 최신 스냅샷 — getCoupangInventoryRows 와 같은 기준.
  // (API 수집분은 availableStock 이 비어 있을 수 있다)
  const stocked = await prisma.inventoryRecord.aggregate({
    where: {
      workspaceId: resolved.workspaceId,
      fileType: 'INVENTORY_HEALTH',
      availableStock: { not: null },
    },
    _max: { snapshotDate: true },
  })
  const snapshotDate = stocked._max.snapshotDate
  if (!snapshotDate) return null

  const records = await prisma.inventoryRecord.findMany({
    where: { workspaceId: resolved.workspaceId, snapshotDate, fileType: 'INVENTORY_HEALTH' },
    select: {
      productId: true,
      optionId: true,
      skuId: true,
      productGrade: true,
      availableStock: true,
    },
  })

  // externalCode → 반품 수량. 매핑은 skuId ?? optionId ?? productId 우선순위로
  // 만들어지지만 과거에 다른 우선순위로 저장된 매핑도 해석돼야 하므로 3키를 모두
  // 인덱싱한다. 충돌 시 **첫 값 유지** — 위 우선순위를 그대로 재현한다.
  const returnByCode = new Map<string, number>()
  for (const r of records) {
    if (!isReturnGrade(r.productGrade)) continue
    if (!r.availableStock) continue
    for (const id of [r.skuId, r.optionId, r.productId]) {
      if (id && !returnByCode.has(id)) returnByCode.set(id, r.availableStock)
    }
  }
  if (returnByCode.size === 0) {
    return { locationId: resolved.locationId, snapshotDate, byOption: new Map() }
  }

  const maps = await prisma.invLocationProductMap.findMany({
    where: { locationId: resolved.locationId, externalCode: { in: [...returnByCode.keys()] } },
    include: { items: { select: { optionId: true, quantity: true } } },
  })

  const byOption = new Map<string, number>()
  for (const m of maps) {
    const qty = returnByCode.get(m.externalCode)
    if (!qty) continue
    for (const item of m.items) {
      // 세트 비율 환산 — 대조 Σ(row.quantity × mapItemQuantity)와 같아야
      // 재고 현황·발주 화면의 숫자가 대조 화면과 맞는다.
      byOption.set(item.optionId, (byOption.get(item.optionId) ?? 0) + qty * item.quantity)
    }
  }

  return { locationId: resolved.locationId, snapshotDate, byOption }
}
