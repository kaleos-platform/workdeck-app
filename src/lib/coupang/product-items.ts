import { prisma } from '@/lib/prisma'

export type CoupangProductItemRowInput = {
  sellerProductId: string
  itemName: string | null
  rgVendorItemId: string | null
  rgSalePrice: number | null
  mpVendorItemId: string | null
  mpSalePrice: number | null
  barcode: string | null
  skuInfo: unknown | null
  statusName: string | null
}

/**
 * 수집 결과를 적재한다. listingId 는 사람이 확정한 매핑이므로 절대 덮지 않는다.
 * 키는 rgVendorItemId 우선, 없으면 mpVendorItemId(마켓플레이스 전용 상품).
 */
export async function upsertCoupangProductItems(
  spaceId: string,
  rows: CoupangProductItemRowInput[]
): Promise<number> {
  const collectedAt = new Date()
  let n = 0

  for (const row of rows) {
    const where = row.rgVendorItemId
      ? { spaceId_rgVendorItemId: { spaceId, rgVendorItemId: row.rgVendorItemId } }
      : row.mpVendorItemId
        ? { spaceId_mpVendorItemId: { spaceId, mpVendorItemId: row.mpVendorItemId } }
        : null
    if (!where) continue

    const data = {
      sellerProductId: row.sellerProductId,
      itemName: row.itemName,
      rgVendorItemId: row.rgVendorItemId,
      rgSalePrice: row.rgSalePrice,
      mpVendorItemId: row.mpVendorItemId,
      mpSalePrice: row.mpSalePrice,
      barcode: row.barcode,
      skuInfo: row.skuInfo === null ? undefined : (row.skuInfo as object),
      statusName: row.statusName,
      collectedAt,
    }

    // MP 축만 있던 행이 나중에 RG 축을 얻으면 키가 rgVendorItemId 로 바뀌어 create 경로를
    // 타고, 기존 행이 이미 가진 mpVendorItemId 와 충돌(P2002)한다. 그 한 행 때문에 남은
    // 배치를 통째로 잃지 않도록 행 단위로 격리한다.
    // ponytail: 근본 해결은 키 선택을 두 축 조회 후 결정하는 것 — 이 패스에서는 범위 밖.
    try {
      await prisma.coupangProductItem.upsert({
        where,
        // listingId 를 create/update 어느 쪽에도 쓰지 않는다 — 수집이 매핑을 지우면 안 된다.
        create: { spaceId, ...data },
        update: data,
      })
      n += 1
    } catch (err) {
      console.error(
        `[product-items] 적재 실패 sellerProductId=${row.sellerProductId} rg=${row.rgVendorItemId} mp=${row.mpVendorItemId}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
  return n
}
