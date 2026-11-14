// 연동 위치(로켓그로스)의 외부 SKU 별 재고·입고예정·30일 판매 — SKU 배분(allocateLinkedSkus) 입력.
//
// SKU 구성 = 재고 조정 매핑(InvLocationProductMap), 수치 = 쿠팡 재고건전성 최신 스냅샷
// (INVENTORY_HEALTH: availableStock·inboundStock·salesQty30d=진짜 30일 rolling).
// 반품 등급 SKU 와 대조 제외 SKU 는 정상 수요를 받을 수 없으므로 뺀다.
import { prisma } from '@/lib/prisma'
import { getCoupangGradeIndex } from '@/lib/inv/coupang-return-stock'
import { isReturnGrade } from '@/lib/inv/product-grade'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import type { LinkedSkuInput } from './linked-sku-allocation'

export type LinkedSkuRow = LinkedSkuInput & {
  name: string
  optionName: string | null
}

export type LinkedSkuLocation = {
  locationId: string
  snapshotDate: Date | null
  skus: LinkedSkuRow[]
}

/** 로켓그로스 위치가 linkedLocationIds 에 있을 때만 SKU 목록을 돌려준다. 없으면 null. */
export async function loadLinkedSkuInputs(
  spaceId: string,
  linkedLocationIds: string[],
  optionIds: string[]
): Promise<LinkedSkuLocation | null> {
  const resolved = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!resolved || !linkedLocationIds.includes(resolved.locationId)) return null
  const optionSet = new Set(optionIds)

  const [maps, excluded] = await Promise.all([
    prisma.invLocationProductMap.findMany({
      where: {
        spaceId,
        locationId: resolved.locationId,
        items: { some: { optionId: { in: optionIds } } },
      },
      select: {
        externalCode: true,
        externalName: true,
        externalOptionName: true,
        items: { select: { optionId: true, quantity: true } },
      },
    }),
    prisma.invReconExcludedCode.findMany({
      where: { spaceId, locationId: resolved.locationId },
      select: { externalCode: true },
    }),
  ])
  const excludedCodes = new Set(excluded.map((e) => e.externalCode))
  // 이 상품 옵션만으로 이루어진 SKU 만 — 다른 상품이 섞이면 이 계획이 채울 수 없다.
  const candidates = maps.filter(
    (m) =>
      !excludedCodes.has(m.externalCode) &&
      m.items.length > 0 &&
      m.items.every((it) => optionSet.has(it.optionId))
  )
  if (candidates.length === 0) {
    return { locationId: resolved.locationId, snapshotDate: null, skus: [] }
  }

  const stocked = await prisma.inventoryRecord.aggregate({
    where: {
      workspaceId: resolved.workspaceId,
      fileType: 'INVENTORY_HEALTH',
      availableStock: { not: null },
    },
    _max: { snapshotDate: true },
  })
  const snapshotDate = stocked._max.snapshotDate ?? null
  const [records, gradeByCode] = await Promise.all([
    snapshotDate
      ? prisma.inventoryRecord.findMany({
          where: { workspaceId: resolved.workspaceId, snapshotDate, fileType: 'INVENTORY_HEALTH' },
          select: {
            skuId: true,
            optionId: true,
            productId: true,
            availableStock: true,
            inboundStock: true,
            salesQty30d: true,
          },
        })
      : Promise.resolve([]),
    getCoupangGradeIndex(resolved.workspaceId),
  ])
  // 매핑 코드는 skuId ?? optionId ?? productId 규칙 — 세 키 모두로 찾되 먼저 들어온 값 유지.
  const recordByCode = new Map<string, (typeof records)[number]>()
  for (const r of records) {
    for (const id of [r.skuId, r.optionId, r.productId]) {
      if (id && !recordByCode.has(id)) recordByCode.set(id, r)
    }
  }

  const skus: LinkedSkuRow[] = candidates
    .filter((m) => !isReturnGrade(gradeByCode.get(m.externalCode)))
    .map((m) => {
      const r = recordByCode.get(m.externalCode)
      return {
        code: m.externalCode,
        name: m.externalName ?? m.externalCode,
        optionName: m.externalOptionName,
        items: m.items.map((it) => ({ optionId: it.optionId, perSet: it.quantity })),
        stock: r?.availableStock ?? 0,
        inbound: r?.inboundStock ?? 0,
        sales30d: r?.salesQty30d ?? 0,
      }
    })

  return { locationId: resolved.locationId, snapshotDate, skus }
}
