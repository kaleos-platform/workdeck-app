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

// ─── 증감 비교용 이전 구간 (명시 캘린더 경계, to-date span 정렬) ─────────────

/**
 * 선택 구간(current)에 대한 증감 비교 이전 구간.
 * - 일(DoD): 전날 하루
 * - 주(WoW): 지난주 같은 구간(월~동일 요일까지). current span 과 일수 동일.
 * - 월(MoM): 지난달 1일 ~ 지난달 동일 일자(말일 clamp). current span 정렬.
 *
 * 부분기간(to-date) 도 일수를 맞춰 비교한다 (API 자동 prev= from−N일 의 요일/일자
 * 정렬 깨짐 문제를 회피).
 */
export function prevRangeForUnit(unit: SalesUnit, current: DateRange): DateRange {
  if (unit === '일') {
    const prev = addDaysYmd(current.from, -1)
    return { from: prev, to: prev }
  }
  if (unit === '주') {
    return {
      from: addDaysYmd(current.from, -7),
      to: addDaysYmd(current.to, -7),
    }
  }
  // 월: 지난달 같은 일수 구간 (1일 ~ 동일 일자, 말일 clamp)
  const [, , toDay] = parseYmd(current.to)
  const prevMonthStart = addDaysYmd(startOfMonth(current.from), -1) // 지난달 말일
  const prevFrom = startOfMonth(prevMonthStart)
  const [py, pm] = parseYmd(prevFrom)
  const prevMonthLastDay = Number(endOfMonth(prevFrom).split('-')[2])
  const clampedDay = Math.min(toDay, prevMonthLastDay)
  return { from: prevFrom, to: toYmd(py, pm, clampedDay) }
}

/** 증감 라벨 (단위 → 비교 약어) */
export function deltaLabelForUnit(unit: SalesUnit): 'DoD' | 'WoW' | 'MoM' {
  return unit === '일' ? 'DoD' : unit === '주' ? 'WoW' : 'MoM'
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
function bucketKey(date: string, unit: SalesUnit): string {
  if (unit === '일') return date
  if (unit === '주') return startOfWeekMon(date)
  return date.slice(0, 7) // YYYY-MM
}

/** 버킷 키 → 표시 라벨 */
function bucketLabel(key: string, unit: SalesUnit): string {
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

/** "기타" 묶음 가상 채널 id */
export const OTHER_CHANNEL_ID = '__기타__'

export const formatKRW = (value: number): string =>
  new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(value)

export type DisplayChannel = { id: string; name: string; color: string; isOther?: boolean }

/**
 * 버킷 전체 매출 합 기준 채널을 desc 정렬하고, topN 초과는 "기타"로 묶는다.
 * 차트 Bar 순서·테이블 열 순서를 동일하게 맞추는 단일 소스.
 *
 * @param channels 전체 판매채널 (id, name)
 * @param buckets bucketRevenue 결과 (매출 합 산출용)
 * @param topN 개별 표시 채널 수 (초과분 "기타")
 */
export function resolveDisplayChannels(
  channels: { id: string; name: string }[],
  buckets: RevenueBucket[],
  topN = 12
): DisplayChannel[] {
  const revById = new Map<string, number>()
  for (const b of buckets) {
    for (const [chId, agg] of Object.entries(b.byChannel)) {
      revById.set(chId, (revById.get(chId) ?? 0) + agg.revenue)
    }
  }
  const sorted = [...channels].sort((a, b) => (revById.get(b.id) ?? 0) - (revById.get(a.id) ?? 0))
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)

  const result: DisplayChannel[] = top.map((c, i) => ({
    id: c.id,
    name: c.name,
    color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
  }))
  if (rest.length > 0) {
    result.push({
      id: OTHER_CHANNEL_ID,
      name: '기타',
      color: '#94a3b8',
      isOther: true,
    })
  }
  return result
}

/** 버킷 한 칸에서 표시 채널(기타 묶음 포함)의 집계를 얻는다. */
export function bucketValueFor(
  bucket: RevenueBucket,
  display: DisplayChannel,
  allDisplay: DisplayChannel[]
): ChannelAgg {
  if (!display.isOther) {
    return bucket.byChannel[display.id] ?? { revenue: 0, orderCount: 0 }
  }
  // 기타 = 전체 - 개별 표시 채널 합
  const namedIds = new Set(allDisplay.filter((d) => !d.isOther).map((d) => d.id))
  let revenue = 0
  let orderCount = 0
  for (const [chId, agg] of Object.entries(bucket.byChannel)) {
    if (!namedIds.has(chId)) {
      revenue += agg.revenue
      orderCount += agg.orderCount
    }
  }
  return { revenue, orderCount }
}

/**
 * 버킷의 "주문" 합계 — 로켓(isUnitCount) 채널의 수량은 제외.
 * bucket.total.orderCount 는 로켓 qty 가 섞여 있어 직접 쓰면 오염되므로 채널별 재집계.
 * 차트 주문 라인 · 테이블 합계 주문수가 동일 값을 공유.
 */
export function bucketOrderTotal(bucket: RevenueBucket, unitCountIds: Set<string>): number {
  let n = 0
  for (const [chId, agg] of Object.entries(bucket.byChannel)) {
    if (!unitCountIds.has(chId)) n += agg.orderCount
  }
  return n
}
