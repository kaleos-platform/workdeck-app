// 쿠팡 매출 구성(광고비 비중) 순수 집계·상태 판정. I/O 없음.

export const SALES_MIX_THRESHOLDS = {
  organicMaxAdShare: 0.05,
  dependentMinAdShare: 0.2,
  organicMinDailyQty: 1,
} as const
export type SalesMixStatus = 'organic' | 'dependent' | 'neutral'

const NO_DATA_NAME = '판매 데이터 없음'
const DAY_MS = 86400000

const utcMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)
const ratio = (num: number, den: number) => (den > 0 ? num / den : null)

export function judgeSalesMixStatus(i: {
  revenue: number
  adCost: number
  salesQty: number
  days: number
}): SalesMixStatus {
  const share = ratio(i.adCost, i.revenue)
  if (share === null) return i.adCost > 0 ? 'dependent' : 'neutral'
  const t = SALES_MIX_THRESHOLDS
  if (share >= t.dependentMinAdShare) return 'dependent'
  if (share <= t.organicMaxAdShare && i.salesQty >= t.organicMinDailyQty * i.days) return 'organic'
  return 'neutral'
}

// 그 날이 속한 주의 월요일 (월요일 시작)
export function weekStartKst(ymd: string): string {
  const ms = utcMs(ymd)
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7
  return new Date(ms - sinceMonday * DAY_MS).toISOString().slice(0, 10)
}

export interface VendorProductRow {
  productId: string
  productName: string
  revenue: number
  salesQty: number
}
export interface VendorDailyRow {
  date: string
  revenue: number
}
export interface AdOptionRow {
  optionId: string | null
  adCost: number
  adRevenue: number
}
export interface AdDailyRow {
  date: string
  adCost: number
}

export interface SalesMixKpi {
  revenue: number
  adCost: number
  adShare: number | null
  coupangAdRevenueShare: number | null
}
export interface SalesMixProductRow {
  productId: string | null
  productName: string
  revenue: number
  salesQty: number
  adCost: number
  adShare: number | null
  coupangAdRevenueShare: number | null
  prevAdShare: number | null
  adShareDeltaPp: number | null
  revenueChangePct: number | null
  status: SalesMixStatus
}
export interface SalesMixWeek {
  weekStart: string
  revenue: number
  adCost: number
  adShare: number | null
}
export interface SalesMixResult {
  from: string
  to: string
  days: number
  missingDays: number
  kpi: SalesMixKpi
  prevKpi: SalesMixKpi
  weeks: SalesMixWeek[]
  products: SalesMixProductRow[]
}

interface Period {
  products: VendorProductRow[]
  ads: AdOptionRow[]
}
interface Agg {
  name: string | null
  revenue: number
  salesQty: number
  adCost: number
  adRevenue: number
}

// 상품별 집계. 벤더 행이 없는 상품·매핑 없는 광고는 null 키(판매 데이터 없음)로 모은다.
function aggregate(period: Period, optionToProduct: Map<string, string>) {
  const map = new Map<string | null, Agg>()
  const get = (id: string | null, name: string | null) => {
    let a = map.get(id)
    if (!a) map.set(id, (a = { name, revenue: 0, salesQty: 0, adCost: 0, adRevenue: 0 }))
    return a
  }
  for (const p of period.products) {
    const a = get(p.productId, p.productName)
    a.name ??= p.productName
    a.revenue += p.revenue
    a.salesQty += p.salesQty
  }
  for (const ad of period.ads) {
    const pid = ad.optionId ? (optionToProduct.get(ad.optionId) ?? null) : null
    const a = get(pid, null)
    a.adCost += ad.adCost
    a.adRevenue += ad.adRevenue
  }
  return map
}

function kpiOf(period: Period): SalesMixKpi {
  const revenue = period.products.reduce((s, p) => s + p.revenue, 0)
  const adCost = period.ads.reduce((s, a) => s + a.adCost, 0)
  const adRevenue = period.ads.reduce((s, a) => s + a.adRevenue, 0)
  return {
    revenue,
    adCost,
    adShare: ratio(adCost, revenue),
    coupangAdRevenueShare: ratio(adRevenue, revenue),
  }
}

export function buildSalesMix(input: {
  from: string
  to: string
  current: Period
  prev: Period
  daily: { vendor: VendorDailyRow[]; ads: AdDailyRow[] }
  optionToProduct: Map<string, string>
}): SalesMixResult {
  const { from, to, current, prev, daily, optionToProduct } = input
  const days = Math.round((utcMs(to) - utcMs(from)) / DAY_MS) + 1
  const seen = new Set(
    daily.vendor.filter((d) => d.date >= from && d.date <= to).map((d) => d.date)
  )
  const missingDays = Math.max(0, days - seen.size)

  const cur = aggregate(current, optionToProduct)
  const prv = aggregate(prev, optionToProduct)

  const products: SalesMixProductRow[] = []
  for (const id of new Set([...cur.keys(), ...prv.keys()])) {
    const c = cur.get(id)
    const pv = prv.get(id)
    if (id === null && !c?.revenue && !c?.adCost && !c?.adRevenue && !pv?.adCost) continue
    const revenue = c?.revenue ?? 0
    const adCost = c?.adCost ?? 0
    const adShare = ratio(adCost, revenue)
    const prevAdShare = pv ? ratio(pv.adCost, pv.revenue) : null
    products.push({
      productId: id,
      productName: id === null ? NO_DATA_NAME : (c?.name ?? pv?.name ?? id),
      revenue,
      salesQty: c?.salesQty ?? 0,
      adCost,
      adShare,
      coupangAdRevenueShare: ratio(c?.adRevenue ?? 0, revenue),
      prevAdShare,
      adShareDeltaPp:
        adShare !== null && prevAdShare !== null ? (adShare - prevAdShare) * 100 : null,
      revenueChangePct: pv && pv.revenue > 0 ? ((revenue - pv.revenue) / pv.revenue) * 100 : null,
      status: judgeSalesMixStatus({ revenue, adCost, salesQty: c?.salesQty ?? 0, days }),
    })
  }
  products.sort((a, b) =>
    (a.productId === null) !== (b.productId === null)
      ? a.productId === null
        ? 1
        : -1
      : b.revenue - a.revenue
  )

  const w = new Map<string, { revenue: number; adCost: number }>()
  const wk = (date: string) => {
    const k = weekStartKst(date)
    let v = w.get(k)
    if (!v) w.set(k, (v = { revenue: 0, adCost: 0 }))
    return v
  }
  for (const d of daily.vendor) wk(d.date).revenue += d.revenue
  for (const d of daily.ads) wk(d.date).adCost += d.adCost
  const weeks = [...w.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, v]) => ({ weekStart, ...v, adShare: ratio(v.adCost, v.revenue) }))

  return { from, to, days, missingDays, kpi: kpiOf(current), prevKpi: kpiOf(prev), weeks, products }
}
