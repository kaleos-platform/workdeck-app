// KST 마감 일별 시계열 + 품절일 판정 (순수 함수)

export type DayPoint = { date: string; qty: number; stockout: boolean }

const DAY_MS = 24 * 60 * 60 * 1000

// option-demand.ts toKstDateKey 와 동일 규칙 (+9h 후 UTC 슬라이스)
export function toKstDateKey(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function addDays(dateKey: string, n: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** "어제" = KST 마감일 */
export function kstYesterday(now: Date): string {
  return toKstDateKey(new Date(now.getTime() - DAY_MS))
}

/** 마지막 원소 = kstYesterday(now), 총 windowDays 일 (빈 날 qty 0) */
export function buildClosedSeries(
  qtyByDate: Record<string, number>,
  windowDays: number,
  now: Date,
  stockoutDates: Set<string> = new Set()
): DayPoint[] {
  const last = kstYesterday(now)
  const out: DayPoint[] = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = addDays(last, -i)
    out.push({ date, qty: qtyByDate[date] ?? 0, stockout: stockoutDates.has(date) })
  }
  return out
}

/**
 * 품절일 = 일 시작 재고 ≤ 0 이고 그날 판매 0.
 * 일 시작 재고(d) = currentStock − Σ net (date ≥ d, d 포함)
 */
export function stockoutDates(input: {
  currentStock: number
  netByDate: Record<string, number>
  salesByDate: Record<string, number>
  dates: string[]
}): Set<string> {
  const { currentStock, netByDate, salesByDate, dates } = input
  const netKeys = Object.keys(netByDate)
  const result = new Set<string>()
  for (const d of dates) {
    let stock = currentStock
    for (const k of netKeys) if (k >= d) stock -= netByDate[k]
    if (stock <= 0 && (salesByDate[d] ?? 0) === 0) result.add(d)
  }
  return result
}

/** 예측 입력 시계열 — 품절일 표시된 KST 마감 시계열 (발주 계획·MCP·재고현황 공용) */
export function buildForecastSeries(i: {
  qtyByDate: Record<string, number>
  /** KST 일자별 재고 순증감(전 위치 합) */
  netByDate: Record<string, number>
  /** 원재고(반품 등급 포함 전 위치 합) */
  currentStock: number
  windowDays: number
  now: Date
}): DayPoint[] {
  const dates = buildClosedSeries({}, i.windowDays, i.now).map((p) => p.date)
  const out = stockoutDates({
    currentStock: i.currentStock,
    netByDate: i.netByDate,
    salesByDate: i.qtyByDate,
    dates,
  })
  return buildClosedSeries(i.qtyByDate, i.windowDays, i.now, out)
}
