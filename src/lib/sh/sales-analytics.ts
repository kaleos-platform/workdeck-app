// 판매분석 페이지 — 기간 계산 + 버킷팅 순수 함수 모듈.
// 모든 날짜는 KST 기준 YYYY-MM-DD 문자열로 다룬다 (시간대 혼동 방지).
// 정합성 코어이므로 UI 컴포넌트가 아닌 이 모듈에 둔다.

import { getTodayStrKst } from '@/lib/date-range'

export type SalesUnit = '일' | '주' | '월'

export type DateRange = { from: string; to: string }

// ─── 날짜 유틸 (YYYY-MM-DD 문자열, KST) ──────────────────────────────────────

/** YYYY-MM-DD → [y, m, d] 숫자 */
function parseYmd(s: string): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number)
  return [y, m, d]
}

/** [y, m, d] → YYYY-MM-DD (m, d 1-base) */
function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * YYYY-MM-DD 에 일수를 더한다 (KST 정오 기준 계산으로 DST/경계 안전).
 * UTC Date 의 정오를 쓰면 일자 산술이 시간대 영향을 받지 않는다.
 */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + days)
  return toYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

/** 0=일 … 6=토 (KST 일자의 요일) */
export function dayOfWeek(ymd: string): number {
  const [y, m, d] = parseYmd(ymd)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

/** 월요일 시작 주의 시작일(월요일) YYYY-MM-DD */
export function startOfWeekMon(ymd: string): string {
  const dow = dayOfWeek(ymd)
  // 월=1 기준 오프셋: 일(0)이면 -6, 그 외 1-dow
  const offset = dow === 0 ? -6 : 1 - dow
  return addDaysYmd(ymd, offset)
}

/** 월의 1일 YYYY-MM-01 */
export function startOfMonth(ymd: string): string {
  const [y, m] = parseYmd(ymd)
  return toYmd(y, m, 1)
}

/** 월의 말일 YYYY-MM-DD */
export function endOfMonth(ymd: string): string {
  const [y, m] = parseYmd(ymd)
  const last = new Date(Date.UTC(y, m, 0, 12, 0, 0)).getUTCDate() // m월 0일 = m-1월 말일
  return toYmd(y, m, last)
}

/** 월 가산/감산 (말일 clamp). 예: addMonthsYmd('2026-03-31', -1) → '2026-02-28' */
export function addMonthsYmd(ymd: string, n: number): string {
  const [y, m, d] = parseYmd(ymd)
  const target = new Date(Date.UTC(y, m - 1 + n, 1, 12, 0, 0))
  const ty = target.getUTCFullYear()
  const tm = target.getUTCMonth() + 1
  const lastDay = new Date(Date.UTC(ty, tm, 0, 12, 0, 0)).getUTCDate()
  return toYmd(ty, tm, Math.min(d, lastDay))
}

/** 마지막 집계완료 KST 일자 = 어제 (로켓 VENDOR 가 어제까지만 수집됨) */
export function lastClosedDateKst(): string {
  return addDaysYmd(getTodayStrKst(), -1)
}

/** 최근 30일: 마지막 집계일 포함 30일 (last-closed 앵커) */
export function last30DaysRange(): DateRange {
  const to = lastClosedDateKst()
  return { from: addDaysYmd(to, -29), to }
}

/**
 * ISO 8601 주차 (연 1~53). 주의 목요일이 속한 해를 기준으로 한다.
 * 월요일 시작 주 정의와 정합.
 */
export function isoWeekOfYear(ymd: string): number {
  const [y, m, d] = parseYmd(ymd)
  const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  // 해당 주의 목요일로 이동 (일=7 보정 후 4-요일)
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 12, 0, 0))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

// ─── 증감 비교용 이전 구간 ───────────────────────────────────────────────────

/** 두 KST 일자의 차이(일). to - from */
function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = parseYmd(from)
  const [ty, tm, td] = parseYmd(to)
  const a = Date.UTC(fy, fm - 1, fd, 12, 0, 0)
  const b = Date.UTC(ty, tm - 1, td, 12, 0, 0)
  return Math.round((b - a) / 86400000)
}

/** 구간이 걸친 달력 월 수 (2026-09-01~2026-09-21 → 1) */
function monthSpan(from: string, to: string): number {
  const [fy, fm] = parseYmd(from)
  const [ty, tm] = parseYmd(to)
  return (ty - fy) * 12 + (tm - fm) + 1
}

/**
 * 선택 구간(current)에 대한 증감 비교 이전 구간.
 *
 * - 달력 월 정렬(1일 시작 + 말일 또는 마지막 집계일 종료) → 같은 개월 수만큼 앞.
 *   말일 종료면 이전 달(들) 전체, 진행중(마지막 집계일) 종료면 같은 일자까지(to-date).
 * - 달력 주 정렬(월요일 시작 + 일요일 또는 마지막 집계일 종료) → 7일 앞.
 * - 그 외 임의 구간 → 길이만큼 통째로 시프트. 단일일은 여기서 자연히 전날이 된다.
 *
 * 표시 단위(일/주/월 토글)는 버킷 크기일 뿐 비교 기준이 아니므로 인자로 받지 않는다.
 * 데이터 기준일이 어제(lastClosedDateKst)라 "이번달"은 말일로 끝나지 않는다 →
 * 마지막 집계일 종료를 달력 경계로 함께 인정하지 않으면 전월 동기 비교가 깨진다.
 */
export function prevRange(current: DateRange): DateRange {
  // 진행중 구간: 데이터 기준일(어제) 또는 오늘로 끝나면 달력 경계로 인정한다.
  const openEnds = [lastClosedDateKst(), getTodayStrKst()]
  const endsAt = (boundary: string) => current.to === boundary || openEnds.includes(current.to)

  // 월 정렬
  if (current.from === startOfMonth(current.from) && endsAt(endOfMonth(current.to))) {
    const months = monthSpan(current.from, current.to)
    const prevFrom = startOfMonth(addMonthsYmd(current.from, -months))
    const prevTo =
      current.to === endOfMonth(current.to)
        ? endOfMonth(addMonthsYmd(prevFrom, months - 1))
        : addMonthsYmd(current.to, -months)
    return { from: prevFrom, to: prevTo }
  }

  // 주 정렬
  if (current.from === startOfWeekMon(current.from) && endsAt(addDaysYmd(current.from, 6))) {
    return { from: addDaysYmd(current.from, -7), to: addDaysYmd(current.to, -7) }
  }

  // 임의 구간: 길이만큼 시프트
  const span = diffDays(current.from, current.to) + 1
  return { from: addDaysYmd(current.from, -span), to: addDaysYmd(current.to, -span) }
}

// ─── 버킷팅 (groupBy=date rows → 단위 버킷) ──────────────────────────────────

export type DateRevenueRow = {
  date: string // YYYY-MM-DD (KST)
  channelId: string
  totalRevenue: number
  orderCount: number
}

export type ChannelAgg = { revenue: number; orderCount: number }

export type RevenueBucket = {
  /** 버킷 키 (정렬·React key 용): 일=YYYY-MM-DD, 주=주시작 YYYY-MM-DD, 월=YYYY-MM */
  key: string
  /** 표시 라벨 */
  label: string
  byChannel: Record<string, ChannelAgg>
  total: ChannelAgg
}

/** 일자 → 버킷 키 */
export function bucketKey(date: string, unit: SalesUnit): string {
  if (unit === '일') return date
  if (unit === '주') return startOfWeekMon(date)
  return date.slice(0, 7) // YYYY-MM
}

/** 버킷 키 → 표시 라벨 */
export function bucketLabel(key: string, unit: SalesUnit): string {
  if (unit === '일') return key.slice(5) // MM-DD
  if (unit === '주') {
    // 주 시작(월)~종료(일) + ISO 연 주차: MM/DD~MM/DD (W주차)
    const start = key.slice(5).replace('-', '/') // MM/DD
    const end = addDaysYmd(key, 6).slice(5).replace('-', '/')
    return `${start}~${end} (W${isoWeekOfYear(key)})`
  }
  const [y, m] = key.split('-')
  return `${y}-${m}`
}

/**
 * groupBy=date rows 를 단위 버킷으로 집계한다.
 * 차트와 테이블이 동일 결과를 공유 → 수치 일관 보장.
 */
export function bucketRevenue(rows: DateRevenueRow[], unit: SalesUnit): RevenueBucket[] {
  const map = new Map<string, RevenueBucket>()

  for (const row of rows) {
    if (!row.date || !row.channelId) continue
    const key = bucketKey(row.date, unit)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = {
        key,
        label: bucketLabel(key, unit),
        byChannel: {},
        total: { revenue: 0, orderCount: 0 },
      }
      map.set(key, bucket)
    }
    const ch = bucket.byChannel[row.channelId] ?? { revenue: 0, orderCount: 0 }
    const rev = Number(row.totalRevenue ?? 0)
    const ord = Number(row.orderCount ?? 0)
    ch.revenue += rev
    ch.orderCount += ord
    bucket.byChannel[row.channelId] = ch
    bucket.total.revenue += rev
    bucket.total.orderCount += ord
  }

  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key))
}

// ─── 증감 계산 ───────────────────────────────────────────────────────────────

/** 변화율 %. prev<=0 이면 null (표시 시 "-"). 소수 1자리. */
export function pctChange(current: number, prev: number): number | null {
  if (prev <= 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
}

// ─── 표시 공통 (차트·테이블 공유) ────────────────────────────────────────────

/** 채널별 색상 팔레트 */
export const CHANNEL_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#be185d',
  '#65a30d',
  '#ea580c',
  '#4338ca',
]

export const formatKRW = (value: number): string =>
  new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)

export type DisplayChannel = { id: string; name: string; color: string }

/**
 * 채널을 버킷 전체 매출 합 기준 desc 정렬하고 색상을 부여한다.
 * "기타" 자동묶음 없음 — 표시 채널은 호출부(유형필터·선택)가 결정한다.
 * 차트 Bar/Line 순서·테이블 열 순서를 맞추는 단일 소스.
 */
export function resolveDisplayChannels(
  channels: { id: string; name: string }[],
  buckets: RevenueBucket[]
): DisplayChannel[] {
  const revById = new Map<string, number>()
  for (const b of buckets) {
    for (const [chId, agg] of Object.entries(b.byChannel)) {
      revById.set(chId, (revById.get(chId) ?? 0) + agg.revenue)
    }
  }
  const sorted = [...channels].sort((a, b) => (revById.get(b.id) ?? 0) - (revById.get(a.id) ?? 0))
  return sorted.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
  }))
}

/** 버킷 한 칸에서 채널의 집계를 얻는다. */
export function bucketValueFor(bucket: RevenueBucket, channelId: string): ChannelAgg {
  return bucket.byChannel[channelId] ?? { revenue: 0, orderCount: 0 }
}

/**
 * 버킷의 주문/매출 합 — 대상 채널 집합 한정.
 * 로켓 포함 모든 판매채널이 "주문" 기준 통일 (orderCount = 주문건수).
 * 테이블 합계·차트가 동일 값을 공유.
 */
export function bucketTotalsFor(
  bucket: RevenueBucket,
  channelIds: Iterable<string>
): { revenue: number; orderCount: number } {
  let revenue = 0
  let orderCount = 0
  for (const id of channelIds) {
    const agg = bucket.byChannel[id]
    if (!agg) continue
    revenue += agg.revenue
    orderCount += agg.orderCount
  }
  return { revenue, orderCount }
}

// ─── 상품(옵션) 단위 판매 — 채널 버킷팅과 평행 구조 ───────────────────────────
// 판매분석 "상품" 탭 전용. 채널 대신 내부 InvProductOption 을 시리즈로 한다.
// 수량(개)과 매출(원)을 함께 담아 화면에서 지표를 토글한다.

/** 상품 탭이 다루는 지표 축. */
export type SalesMetric = 'qty' | 'revenue'

/** 수량·매출 쌍. 버킷 한 칸이 두 지표를 동시에 들고 있어야 토글이 재호출 없이 된다. */
export type OptionMetrics = { qty: number; revenue: number }

export type OptionQtyRow = {
  date: string // YYYY-MM-DD (KST)
  optionId: string // 내부 InvProductOption.id
  optionName: string // 옵션명 (InvProductOption.name)
  productId: string // 내부 InvProduct.id
  productName: string // 상품명 (관리명 우선)
  /** 상품 그룹(카테고리). 부자재·체험단 같은 비판매 그룹을 걸러내는 축. */
  productGroupId: string | null
  productGroupName: string | null
  channelId: string
  quantity: number
  revenue: number
}

export type OptionBucket = {
  /** 버킷 키: 일=YYYY-MM-DD, 주=주시작 YYYY-MM-DD, 월=YYYY-MM */
  key: string
  label: string
  byOption: Record<string, OptionMetrics> // optionId → 수량·매출
  total: OptionMetrics
}

/** groupBy=date 옵션 행을 단위 버킷으로 집계 (채널은 합산, 옵션 grain 유지). */
export function bucketOptionQty(rows: OptionQtyRow[], unit: SalesUnit): OptionBucket[] {
  const map = new Map<string, OptionBucket>()
  for (const row of rows) {
    if (!row.date || !row.optionId) continue
    const key = bucketKey(row.date, unit)
    let bucket = map.get(key)
    if (!bucket) {
      bucket = { key, label: bucketLabel(key, unit), byOption: {}, total: { qty: 0, revenue: 0 } }
      map.set(key, bucket)
    }
    const qty = Number(row.quantity ?? 0)
    const revenue = Number(row.revenue ?? 0)
    const cur = bucket.byOption[row.optionId] ?? { qty: 0, revenue: 0 }
    cur.qty += qty
    cur.revenue += revenue
    bucket.byOption[row.optionId] = cur
    bucket.total.qty += qty
    bucket.total.revenue += revenue
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key))
}

// ─── 상품→옵션 계층 카탈로그 (필터 목록 — 기간 내 판매 항목만) ────────────────

export type OptionCatalogOption = {
  optionId: string
  optionName: string
  qty: number
  revenue: number
}
export type OptionCatalogProduct = {
  productId: string
  productName: string
  productGroupId: string | null
  qty: number
  revenue: number
  options: OptionCatalogOption[]
}

/**
 * 기간 내 판매 데이터가 있는 상품→옵션 계층 카탈로그를 만든다(필터 드롭다운용).
 * 판매량 desc 정렬. rows 에 등장한 항목만 포함 → "기간 내 판매 있는 항목만" 보장.
 */
export function buildOptionCatalog(rows: OptionQtyRow[]): OptionCatalogProduct[] {
  const products = new Map<
    string,
    {
      productName: string
      groupId: string | null
      qty: number
      revenue: number
      options: Map<string, OptionCatalogOption>
    }
  >()
  for (const r of rows) {
    const qty = Number(r.quantity ?? 0)
    const revenue = Number(r.revenue ?? 0)
    if (qty <= 0 && revenue === 0) continue
    let p = products.get(r.productId)
    if (!p) {
      p = {
        productName: r.productName,
        groupId: r.productGroupId,
        qty: 0,
        revenue: 0,
        options: new Map(),
      }
      products.set(r.productId, p)
    }
    p.qty += qty
    p.revenue += revenue
    const o = p.options.get(r.optionId)
    if (o) {
      o.qty += qty
      o.revenue += revenue
    } else {
      p.options.set(r.optionId, {
        optionId: r.optionId,
        optionName: r.optionName,
        qty,
        revenue,
      })
    }
  }
  return Array.from(products.entries())
    .map(([productId, p]) => ({
      productId,
      productName: p.productName,
      productGroupId: p.groupId,
      qty: p.qty,
      revenue: p.revenue,
      options: Array.from(p.options.values()).sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

// ─── 시리즈 해석 (선택 → 차트 선·표 열) ──────────────────────────────────────
// 미선택 = 전체 합산 1선. 상품 선택 = 그 상품의 모든 옵션 합산 1선.
// 옵션 선택 = 옵션당 1선. 선택은 그래프·표 공통 단일 소스.

/** 전체 합산 시리즈의 고정 id. */
export const OTHER_SERIES_ID = '__other__'
const OTHER_SERIES_COLOR = '#9ca3af'

/** 차트 선 / 표 열 한 개. optionIds = 이 시리즈가 합산하는 옵션 집합. */
export type OptionSeries = {
  id: string
  name: string
  color: string
  optionIds: string[]
}

export type OptionSelection = {
  /** 선택 상품 id (옵션 미지정 → 상품 전체 합산 1선) */
  productIds: string[]
  /** 선택 옵션 id (상품 내 특정 옵션 → 옵션당 1선) */
  optionIds: string[]
}

export const MAX_OPTION_SERIES = 8

/**
 * 선택 + 카탈로그 → 시리즈 배열(차트 선·표 열 단일 소스).
 * - 미선택: 지표 상위 상품 7개 + 「기타」(나머지 합산) — 누적 막대 높이 = 전체 합계.
 * - 상품 선택(옵션 미선택): 상품당 1선 (상품의 모든 옵션 합산).
 * - 옵션 선택: 옵션당 1선. 상품 선택 + 그 상품 옵션 선택 시 옵션선이 우선(상품 전체선 대체).
 * 최대 MAX_OPTION_SERIES 선. 색상 CHANNEL_COLORS 순환.
 */
export function resolveOptionSeries(
  selection: OptionSelection,
  catalog: OptionCatalogProduct[],
  metric: SalesMetric = 'qty'
): OptionSeries[] {
  const color = (i: number) => CHANNEL_COLORS[i % CHANNEL_COLORS.length]
  const { productIds, optionIds } = selection

  // 미선택 → 상위 상품 + 기타
  if (productIds.length === 0 && optionIds.length === 0) {
    const ranked = [...catalog].sort((a, b) => b[metric] - a[metric])
    const top = ranked.slice(0, MAX_OPTION_SERIES - 1).map((p, i) => ({
      id: p.productId,
      name: p.productName,
      color: color(i),
      optionIds: p.options.map((o) => o.optionId),
    }))
    const rest = ranked
      .slice(MAX_OPTION_SERIES - 1)
      .flatMap((p) => p.options.map((o) => o.optionId))
    return rest.length
      ? [...top, { id: OTHER_SERIES_ID, name: '기타', color: OTHER_SERIES_COLOR, optionIds: rest }]
      : top
  }

  const series: OptionSeries[] = []
  const optionToProduct = new Map<string, OptionCatalogProduct>()
  for (const p of catalog) for (const o of p.options) optionToProduct.set(o.optionId, p)

  // 옵션 선택분이 속한 상품 — 그 상품은 전체선 대신 옵션선으로 표현
  const productsWithSelectedOption = new Set(
    optionIds.map((oid) => optionToProduct.get(oid)?.productId).filter(Boolean) as string[]
  )

  // 1) 옵션선 (옵션당 1선)
  for (const oid of optionIds) {
    const p = optionToProduct.get(oid)
    const opt = p?.options.find((o) => o.optionId === oid)
    if (!opt) continue
    series.push({
      id: oid,
      name: `${p?.productName ?? ''} / ${opt.optionName}`,
      color: color(series.length),
      optionIds: [oid],
    })
  }

  // 2) 상품선 (옵션 미선택 상품만 — 상품 전체 옵션 합산 1선)
  for (const pid of productIds) {
    if (productsWithSelectedOption.has(pid)) continue // 옵션선으로 이미 표현
    const p = catalog.find((c) => c.productId === pid)
    if (!p) continue
    series.push({
      id: pid,
      name: p.productName,
      color: color(series.length),
      optionIds: p.options.map((o) => o.optionId),
    })
  }

  return series.slice(0, MAX_OPTION_SERIES)
}

/** 버킷 한 칸에서 한 시리즈의 값(시리즈가 합산하는 옵션들의 합). */
export function seriesBucketValue(
  bucket: OptionBucket,
  series: OptionSeries,
  metric: SalesMetric = 'qty'
): number {
  let sum = 0
  for (const oid of series.optionIds) sum += bucket.byOption[oid]?.[metric] ?? 0
  return sum
}

// ─── 상품 랭킹 (상품 탭 1급 뷰) ───────────────────────────────────────────────
// 행=상품, 펼치면 채널별·옵션별 내역. 정렬·토글이 재호출 없이 되도록 클라이언트에서 만든다.
// 서버가 랭킹을 따로 내면 같은 숫자가 두 경로로 생겨 어긋난다.

/** 이전 구간 합계 (비교 전용, 날짜 grain 없음). */
export type PrevOptionTotal = {
  optionId: string
  productId: string
  productGroupId?: string | null
  quantity: number
  revenue: number
  /** 이번 구간에 판매가 없어 현재 행이 없는 상품/옵션의 이름 표시용. */
  productName?: string
  optionName?: string
}

/** 상품에 귀속시키지 못한 매출 — 랭킹 맨 아래 고정 행이 된다. */
export type UnmatchedTotals = {
  revenue: number
  quantity: number
  prevRevenue?: number
  byReason?: Record<string, number>
}

/** 옵션별 비용·공헌이익 (서버 margin-query 결과). */
export type OptionMargin = {
  optionId: string
  /** 판매 없이 비용(광고비)만 있는 옵션을 행으로 살리기 위한 이름·소속. */
  productId?: string
  productName?: string
  optionName?: string
  productGroupId?: string | null
  cogs: number
  commissionFee: number
  shippingCost: number
  packagingCost: number
  adCost: number
  contributionProfit: number
  /** 0 이면 원가 미입력 — 공헌이익이 과대평가된다. */
  unitCost: number
}

/** 공헌이익 합계. 원가 미입력 옵션이 섞였는지도 같이 들고 다닌다. */
export type MarginTotals = {
  contributionProfit: number
  /** 공헌이익률 = 공헌이익 / 매출. 매출 0이면 null. */
  marginRatio: number | null
  /** 매출이 있는데 원가가 없는 옵션이 섞임 → 이익이 과대평가됨. */
  costMissing: boolean
}

export type RankingOption = {
  optionId: string
  optionName: string
  quantity: number
  revenue: number
  prevQuantity: number
  prevRevenue: number
  margin: MarginTotals | null
}

export type RankingChannel = {
  channelId: string
  quantity: number
  revenue: number
}

export type RankingRow = {
  productId: string
  productName: string
  productGroupId: string | null
  productGroupName: string | null
  quantity: number
  revenue: number
  prevQuantity: number
  prevRevenue: number
  /** 총매출(미매칭 포함) 대비 매출 비중 0~1. 총매출 0이면 null. */
  share: number | null
  margin: MarginTotals | null
  options: RankingOption[]
  byChannel: RankingChannel[]
}

export type ProductRanking = {
  rows: RankingRow[]
  unmatched: UnmatchedTotals & { share: number | null }
  /** rows + unmatched. 채널 탭 총매출과 일치해야 한다. */
  totals: { quantity: number; revenue: number; prevRevenue: number }
  /** 상품 행들의 공헌이익 합(미매칭은 비용을 알 수 없어 제외). */
  marginTotals: MarginTotals | null
}

/** 옵션 비용 목록 → 매출 기준 공헌이익 합계. */
function sumMargin(
  items: { revenue: number; margin: OptionMargin | undefined }[]
): MarginTotals | null {
  if (items.every((i) => !i.margin)) return null
  let profit = 0
  let revenue = 0
  let costMissing = false
  for (const i of items) {
    revenue += i.revenue
    if (!i.margin) continue
    profit += i.margin.contributionProfit
    if (i.revenue > 0 && !i.margin.unitCost) costMissing = true
  }
  return {
    contributionProfit: profit,
    marginRatio: revenue > 0 ? profit / revenue : null,
    costMissing,
  }
}

/**
 * 일자×옵션×채널 행 → 상품 단위 랭킹.
 * 정렬은 호출부(테이블 헤더)가 하고 여기서는 매출 desc 기본 정렬만 한다.
 */
export function buildProductRanking(
  rows: OptionQtyRow[],
  prevTotals: PrevOptionTotal[],
  unmatched: UnmatchedTotals,
  margins: OptionMargin[] = []
): ProductRanking {
  const marginByOption = new Map(margins.map((m) => [m.optionId, m]))
  const prevByOption = new Map(prevTotals.map((p) => [p.optionId, p]))

  type Acc = {
    productName: string
    groupId: string | null
    groupName: string | null
    quantity: number
    revenue: number
    options: Map<string, RankingOption>
    channels: Map<string, RankingChannel>
  }
  const products = new Map<string, Acc>()

  for (const r of rows) {
    const qty = Number(r.quantity ?? 0)
    const revenue = Number(r.revenue ?? 0)
    let p = products.get(r.productId)
    if (!p) {
      p = {
        productName: r.productName,
        groupId: r.productGroupId,
        groupName: r.productGroupName,
        quantity: 0,
        revenue: 0,
        options: new Map(),
        channels: new Map(),
      }
      products.set(r.productId, p)
    }
    p.quantity += qty
    p.revenue += revenue

    const opt = p.options.get(r.optionId)
    if (opt) {
      opt.quantity += qty
      opt.revenue += revenue
    } else {
      p.options.set(r.optionId, {
        optionId: r.optionId,
        optionName: r.optionName,
        quantity: qty,
        revenue,
        prevQuantity: 0,
        prevRevenue: 0,
        margin: null,
      })
    }

    const ch = p.channels.get(r.channelId)
    if (ch) {
      ch.quantity += qty
      ch.revenue += revenue
    } else {
      p.channels.set(r.channelId, { channelId: r.channelId, quantity: qty, revenue })
    }
  }

  // 판매는 없는데 비용(주로 광고비)만 나간 옵션도 행으로 살린다. 빼면 그 비용이
  // 합계 공헌이익에서 빠져 공헌이익 API 와 어긋나고, 정작 봐야 할 "돈만 쓴 상품"이 숨는다.
  for (const mg of margins) {
    if (!mg.productId) continue
    let p = products.get(mg.productId)
    if (p?.options.has(mg.optionId)) continue
    if (!p) {
      p = {
        productName: mg.productName ?? '(이름 미상)',
        groupId: mg.productGroupId ?? null,
        groupName: null,
        quantity: 0,
        revenue: 0,
        options: new Map(),
        channels: new Map(),
      }
      products.set(mg.productId, p)
    }
    p.options.set(mg.optionId, {
      optionId: mg.optionId,
      optionName: mg.optionName ?? '(이름 미상)',
      quantity: 0,
      revenue: 0,
      prevQuantity: 0,
      prevRevenue: 0,
      margin: null,
    })
  }

  // 이전 구간: 이번 구간에 없던 상품/옵션도 행으로 살린다(급감 탐지에 필요).
  // 이름은 prevTotals 가 실어온 값을 쓴다 — 없으면 상품을 못 알아보는 행이 생긴다.
  for (const prev of prevTotals) {
    let p = products.get(prev.productId)
    if (!p) {
      p = {
        productName: prev.productName ?? '(이름 미상)',
        groupId: prev.productGroupId ?? null,
        groupName: null,
        quantity: 0,
        revenue: 0,
        options: new Map(),
        channels: new Map(),
      }
      products.set(prev.productId, p)
    } else if (!p.productName && prev.productName) {
      p.productName = prev.productName
    }
    const opt = p.options.get(prev.optionId)
    if (opt) {
      opt.prevQuantity += prev.quantity
      opt.prevRevenue += prev.revenue
    } else {
      p.options.set(prev.optionId, {
        optionId: prev.optionId,
        optionName: prev.optionName ?? '(이름 미상)',
        quantity: 0,
        revenue: 0,
        prevQuantity: prev.quantity,
        prevRevenue: prev.revenue,
        margin: null,
      })
    }
  }

  // 옵션에 흩어진 이전 값을 상품 합계로 올린다.
  const built: RankingRow[] = Array.from(products.entries()).map(([productId, p]) => {
    const options = Array.from(p.options.values()).map((o) => {
      const prev = prevByOption.get(o.optionId)
      const withPrev = prev ? { ...o, prevQuantity: prev.quantity, prevRevenue: prev.revenue } : o
      return {
        ...withPrev,
        margin: sumMargin([{ revenue: o.revenue, margin: marginByOption.get(o.optionId) }]),
      }
    })
    return {
      productId,
      productName: p.productName,
      productGroupId: p.groupId,
      productGroupName: p.groupName,
      quantity: p.quantity,
      revenue: p.revenue,
      prevQuantity: options.reduce((a, o) => a + o.prevQuantity, 0),
      prevRevenue: options.reduce((a, o) => a + o.prevRevenue, 0),
      share: null,
      margin: sumMargin(
        options.map((o) => ({ revenue: o.revenue, margin: marginByOption.get(o.optionId) }))
      ),
      options: options.sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity),
      byChannel: Array.from(p.channels.values()).sort((a, b) => b.revenue - a.revenue),
    }
  })

  const totalRevenue = built.reduce((a, r) => a + r.revenue, 0) + unmatched.revenue
  const totalQuantity = built.reduce((a, r) => a + r.quantity, 0) + unmatched.quantity
  const totalPrevRevenue =
    built.reduce((a, r) => a + r.prevRevenue, 0) + (unmatched.prevRevenue ?? 0)

  const withShare = built
    .map((r) => ({ ...r, share: totalRevenue > 0 ? r.revenue / totalRevenue : null }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)

  return {
    rows: withShare,
    unmatched: {
      ...unmatched,
      share: totalRevenue > 0 ? unmatched.revenue / totalRevenue : null,
    },
    totals: { quantity: totalQuantity, revenue: totalRevenue, prevRevenue: totalPrevRevenue },
    marginTotals: sumMargin(
      withShare.flatMap((r) =>
        r.options.map((o) => ({ revenue: o.revenue, margin: marginByOption.get(o.optionId) }))
      )
    ),
  }
}
