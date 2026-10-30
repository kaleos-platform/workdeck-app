import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { buildSalesMix, type SalesMixResult } from '@/lib/coupang-ads/sales-mix'

export type SalesMixEmptyReason = 'collection-off' | 'no-data'

export interface SalesMixProductDetail {
  daily: { date: string; revenue: number; adCost: number }[]
  options: { optionId: string; optionName: string | null; revenue: number; salesQty: number }[]
}

const DAY_MS = 86400000
const VENDOR = 'VENDOR_ITEM_METRICS'
const num = (v: unknown) => Number(v ?? 0)
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const kstStart = (d: string) => new Date(d + 'T00:00:00+09:00')
const kstEnd = (d: string) => new Date(d + 'T23:59:59+09:00')
const SNAP_DAY = Prisma.sql`to_char((("snapshotDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')`
const AD_DAY = Prisma.sql`to_char((("date" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD')`

function ranges(startDate: string, endDate: string) {
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS) + 1
  const prevEnd = ymd(Date.parse(startDate) - DAY_MS)
  const prevStart = ymd(Date.parse(startDate) - days * DAY_MS)
  return {
    start: kstStart(startDate),
    end: kstEnd(endDate),
    prevStart: kstStart(prevStart),
    prevEnd: kstEnd(prevEnd),
  }
}

type R = ReturnType<typeof ranges>

// 옵션 → 상품 (이전·현재 기간 중 가장 최근 스냅샷 기준)
const loadOptionMap = (workspaceId: string, r: R) =>
  prisma.$queryRaw<{ optionId: string; productId: string }[]>`
    SELECT DISTINCT ON ("optionId") "optionId", "productId"
    FROM "InventoryRecord"
    WHERE "workspaceId" = ${workspaceId} AND "fileType" = ${VENDOR}
      AND "snapshotDate" BETWEEN ${r.prevStart} AND ${r.end}
    ORDER BY "optionId", "snapshotDate" DESC`

export async function querySalesMix(
  workspaceId: string,
  opts: { startDate: string; endDate: string }
): Promise<SalesMixResult | { empty: SalesMixEmptyReason }> {
  const cred = await prisma.coupangCredential.findUnique({
    where: { workspaceId },
    select: { collectVendorSales: true },
  })
  if (cred && cred.collectVendorSales === false) return { empty: 'collection-off' }

  const r = ranges(opts.startDate, opts.endDate)
  const [products, vendorDaily, ads, adDaily, optionMap] = await Promise.all([
    prisma.$queryRaw<
      {
        productId: string
        productName: string
        revenue: unknown
        salesQty: unknown
        period: string
      }[]
    >`
      SELECT "productId",
        (array_agg("productName" ORDER BY "snapshotDate" DESC))[1] AS "productName",
        COALESCE(SUM("revenue30d"), 0) AS revenue,
        COALESCE(SUM("salesQty30d"), 0) AS "salesQty",
        CASE WHEN "snapshotDate" >= ${r.start} THEN 'cur' ELSE 'prev' END AS period
      FROM "InventoryRecord"
      WHERE "workspaceId" = ${workspaceId} AND "fileType" = ${VENDOR}
        AND "snapshotDate" BETWEEN ${r.prevStart} AND ${r.end}
      GROUP BY "productId", period`,
    prisma.$queryRaw<{ date: string; revenue: unknown }[]>`
      SELECT ${SNAP_DAY} AS date, COALESCE(SUM("revenue30d"), 0) AS revenue
      FROM "InventoryRecord"
      WHERE "workspaceId" = ${workspaceId} AND "fileType" = ${VENDOR}
        AND "snapshotDate" BETWEEN ${r.start} AND ${r.end}
      GROUP BY 1`,
    prisma.$queryRaw<
      { optionId: string | null; adCost: unknown; adRevenue: unknown; period: string }[]
    >`
      SELECT "optionId", SUM("adCost") AS "adCost", SUM("revenue1d") AS "adRevenue",
        CASE WHEN "date" >= ${r.start} THEN 'cur' ELSE 'prev' END AS period
      FROM "AdRecord"
      WHERE "workspaceId" = ${workspaceId} AND "date" BETWEEN ${r.prevStart} AND ${r.end}
      GROUP BY "optionId", period`,
    prisma.$queryRaw<{ date: string; adCost: unknown }[]>`
      SELECT ${AD_DAY} AS date, SUM("adCost") AS "adCost"
      FROM "AdRecord"
      WHERE "workspaceId" = ${workspaceId} AND "date" BETWEEN ${r.start} AND ${r.end}
      GROUP BY 1`,
    loadOptionMap(workspaceId, r),
  ])

  const vp = products.map((p) => ({
    period: p.period,
    row: {
      productId: p.productId,
      productName: p.productName,
      revenue: num(p.revenue),
      salesQty: num(p.salesQty),
    },
  }))
  if (!vp.some((p) => p.period === 'cur')) return { empty: 'no-data' }
  const ap = ads.map((a) => ({
    period: a.period,
    row: { optionId: a.optionId, adCost: num(a.adCost), adRevenue: num(a.adRevenue) },
  }))
  const pick = <T>(xs: { period: string; row: T }[], p: string) =>
    xs.filter((x) => x.period === p).map((x) => x.row)

  return buildSalesMix({
    from: opts.startDate,
    to: opts.endDate,
    current: { products: pick(vp, 'cur'), ads: pick(ap, 'cur') },
    prev: { products: pick(vp, 'prev'), ads: pick(ap, 'prev') },
    daily: {
      vendor: vendorDaily.map((d) => ({ date: d.date, revenue: num(d.revenue) })),
      ads: adDaily.map((d) => ({ date: d.date, adCost: num(d.adCost) })),
    },
    optionToProduct: new Map(optionMap.map((o) => [o.optionId, o.productId])),
  })
}

export async function querySalesMixProductDetail(
  workspaceId: string,
  opts: { startDate: string; endDate: string; productId: string }
): Promise<SalesMixProductDetail> {
  const r = ranges(opts.startDate, opts.endDate)
  const optionMap = await loadOptionMap(workspaceId, r)
  const optionIds = optionMap.filter((o) => o.productId === opts.productId).map((o) => o.optionId)

  const [vendorDaily, optionRows, adDaily] = await Promise.all([
    prisma.$queryRaw<{ date: string; revenue: unknown }[]>`
      SELECT ${SNAP_DAY} AS date, COALESCE(SUM("revenue30d"), 0) AS revenue
      FROM "InventoryRecord"
      WHERE "workspaceId" = ${workspaceId} AND "fileType" = ${VENDOR}
        AND "productId" = ${opts.productId} AND "snapshotDate" BETWEEN ${r.start} AND ${r.end}
      GROUP BY 1`,
    prisma.$queryRaw<
      { optionId: string; optionName: string | null; revenue: unknown; salesQty: unknown }[]
    >`
      SELECT "optionId", (array_agg("optionName" ORDER BY "snapshotDate" DESC))[1] AS "optionName",
        COALESCE(SUM("revenue30d"), 0) AS revenue, COALESCE(SUM("salesQty30d"), 0) AS "salesQty"
      FROM "InventoryRecord"
      WHERE "workspaceId" = ${workspaceId} AND "fileType" = ${VENDOR}
        AND "productId" = ${opts.productId} AND "snapshotDate" BETWEEN ${r.start} AND ${r.end}
      GROUP BY "optionId"
      ORDER BY revenue DESC`,
    optionIds.length === 0
      ? Promise.resolve([] as { date: string; adCost: unknown }[])
      : prisma.$queryRaw<{ date: string; adCost: unknown }[]>`
      SELECT ${AD_DAY} AS date, SUM("adCost") AS "adCost"
      FROM "AdRecord"
      WHERE "workspaceId" = ${workspaceId} AND "optionId" = ANY(${optionIds}::text[])
        AND "date" BETWEEN ${r.start} AND ${r.end}
      GROUP BY 1`,
  ])

  const rev = new Map(vendorDaily.map((d) => [d.date, num(d.revenue)]))
  const ad = new Map(adDaily.map((d) => [d.date, num(d.adCost)]))
  const daily: SalesMixProductDetail['daily'] = []
  for (let t = Date.parse(opts.startDate); t <= Date.parse(opts.endDate); t += DAY_MS) {
    const date = ymd(t)
    daily.push({ date, revenue: rev.get(date) ?? 0, adCost: ad.get(date) ?? 0 })
  }
  return {
    daily,
    options: optionRows.map((o) => ({
      optionId: o.optionId,
      optionName: o.optionName,
      revenue: num(o.revenue),
      salesQty: num(o.salesQty),
    })),
  }
}
