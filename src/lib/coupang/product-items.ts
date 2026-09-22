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

    await prisma.coupangProductItem.upsert({
      where,
      // listingId 를 create/update 어느 쪽에도 쓰지 않는다 — 수집이 매핑을 지우면 안 된다.
      create: { spaceId, ...data },
      update: data,
    })
    n += 1
  }
  return n
}
