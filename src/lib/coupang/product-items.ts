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
 * 기존 행은 rgVendorItemId·mpVendorItemId 중 하나라도 같으면 같은 상품으로 보고 갱신한다
 * (MP 축만 있던 행이 나중에 RG 축을 얻어도 새 행을 만들지 않는다).
 */
export async function upsertCoupangProductItems(
  spaceId: string,
  rows: CoupangProductItemRowInput[]
): Promise<number> {
  const collectedAt = new Date()
  let n = 0

  for (const row of rows) {
    const keys = [
      ...(row.rgVendorItemId ? [{ rgVendorItemId: row.rgVendorItemId }] : []),
      ...(row.mpVendorItemId ? [{ mpVendorItemId: row.mpVendorItemId }] : []),
    ]
    if (keys.length === 0) continue

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

    // 행 단위로 격리한다 — 한 행 실패로 남은 배치를 잃지 않는다.
    try {
      const existing = await prisma.coupangProductItem.findMany({
        where: { spaceId, OR: keys },
        select: { id: true },
        take: 2,
      })
      // 두 축이 서로 다른 기존 행에 걸려 있으면 합칠 수 없다 — 사람이 정리해야 한다
      if (existing.length > 1) throw new Error('RG·MP 축이 서로 다른 기존 행에 있음')
      if (existing.length === 1) {
        // listingId 는 쓰지 않는다 — 수집이 사람이 확정한 매핑을 지우면 안 된다.
        await prisma.coupangProductItem.update({ where: { id: existing[0].id }, data })
      } else {
        await prisma.coupangProductItem.create({ data: { spaceId, ...data } })
      }
      n += 1
    } catch (err) {
      console.error(
        `[product-items] 적재 실패 sellerProductId=${row.sellerProductId} rg=${row.rgVendorItemId} mp=${row.mpVendorItemId}:`,
        err
      )
    }
  }
  return n
}
