/**
 * 대사 순수 로직 — DB·Slack 없음.
 * 원본 3개: (가) 관측 행 (나) 일일 전수 조회 (다) 엑셀 DelOrder. 판정 A~E 와 수집 상태 게이트, 키 진단 리포트.
 */
import { isCancelled, keyPattern, normalizeOrderNumber } from './normalize'

export type MatchField = 'externalOrderId' | 'externalLineKey' | 'lineKeyOrderPart'
export type MatchRule = { field: MatchField } | null

export type ObsLine = {
  key: string
  orderId: string
  quantity: number
  status: string
  claimStatus: string | null
  paidAt: Date
  shippingDueAt: Date | null
  trackingNumber: string | null
  dispatchedAt: Date | null
  deliveryKind: string
  productName: string
  /** 별칭 사전으로 대응된 상품 대상('L:id'|'O:id'). 없으면 null */
  target: string | null
}
export type ScanLine = { key: string; orderId: string; quantity: number; status: string }
export type ExcelOrder = {
  orderNumber: string
  quantity: number
  completed: boolean
  /** 항목별 대상('L:id'|'O:id'), 매칭 안 된 항목은 null */
  targets: Array<string | null>
  /** 이 채널로 연결된 주문인지(channelId) */
  channelLinked: boolean
}

const DAY = 86_400_000
const KST = 9 * 3_600_000
export const ARRIVAL_GUARANTEE = 'ARRIVAL_GUARANTEE'

export const keyOf = (l: Pick<ObsLine, 'key' | 'orderId'>, f: MatchField): string =>
  normalizeOrderNumber(
    f === 'externalOrderId' ? l.orderId : f === 'externalLineKey' ? l.key : l.key.split(':')[0]
  )

/** 결제 후 영업일(토·일 제외, KST) 1일 뒤 시각. */
export function oneBusinessDayAfter(d: Date): Date {
  let t = d.getTime() + DAY
  for (;;) {
    const wd = new Date(t + KST).getUTCDay()
    if (wd !== 0 && wd !== 6) return new Date(t)
    t += DAY
  }
}

// ─── 수집 상태 게이트 ─────────────────────────────────────────────────────────

export type GateInput = {
  now: Date
  /** 최근 24시간 OBSERVE operation */
  recentObserve: Array<{ status: string }>
  cursor: { at: string; catchingUp: boolean } | null
  /** 가장 최근 FULL_SCAN operation(없으면 null) */
  lastScan: {
    status: string
    finishedAt: Date | null
    counts: {
      periodFrom?: string
      periodTo?: string
      structureOk?: boolean
      pagesRequested?: number
      pagesReceived?: number
    }
  } | null
  scanDays?: number
}

/** 비어 있으면 통과. 하나라도 있으면 그 채널은 "판정 불가". */
export function evaluateGate(g: GateInput): string[] {
  const r: string[] = []
  const now = g.now.getTime()
  if (g.recentObserve.some((o) => o.status === 'FAILED' || o.status === 'PARTIAL'))
    r.push('observe_failed_recent')
  if (!g.cursor || now - Date.parse(g.cursor.at) > 2 * 3_600_000) r.push('cursor_lag')
  if (!g.cursor || g.cursor.catchingUp) r.push('catching_up')
  const s = g.lastScan
  const days = g.scanDays ?? 7
  if (!s || !s.finishedAt || now - s.finishedAt.getTime() > DAY) r.push('scan_missing')
  else if (
    s.status !== 'SUCCEEDED' ||
    s.counts.structureOk !== true ||
    s.counts.pagesRequested !== s.counts.pagesReceived
  )
    r.push('scan_incomplete')
  else if (
    !s.counts.periodFrom ||
    !s.counts.periodTo ||
    Date.parse(s.counts.periodFrom) > now - days * DAY + 3_600_000 ||
    Date.parse(s.counts.periodTo) < now - DAY / 2
  )
    r.push('scan_period_short')
  return r
}

// ─── 판정 A~E ─────────────────────────────────────────────────────────────────

export type Finding = { ref: string; note: string }
export type Verdict = { A: Finding[]; B: Finding[]; C: Finding[]; D: Finding[]; E: Finding[] }

export function judge(input: {
  now: Date
  obs: ObsLine[]
  scan: ScanLine[]
  excel: ExcelOrder[]
  rule: MatchRule
}): Verdict {
  const { now, obs, scan, excel, rule } = input
  const v: Verdict = { A: [], B: [], C: [], D: [], E: [] }
  const hours = (d: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 3_600_000))

  // A (나)↔(가): 행 키 단위 + 행별 수량·상태
  const obsByKey = new Map(obs.map((l) => [l.key, l]))
  for (const s of scan) {
    const o = obsByKey.get(s.key)
    if (!o) v.A.push({ ref: s.orderId, note: '전수 조회에는 있으나 관측에 없음' })
    else if (o.quantity !== s.quantity)
      v.A.push({ ref: s.orderId, note: `수량 차이 관측 ${o.quantity} / 전수 ${s.quantity}` })
    else if (o.status !== s.status)
      v.A.push({ ref: s.orderId, note: `상태 차이 ${o.status} / ${s.status}` })
  }

  // E 출고 지연
  const eligible = obs.filter(
    (l) =>
      l.deliveryKind !== ARRIVAL_GUARANTEE &&
      (l.paidAt.getTime() >= now.getTime() - 7 * DAY ||
        (!l.dispatchedAt && !isCancelled({ channelStatus: l.status, claimStatus: l.claimStatus })))
  )
  for (const l of eligible) {
    if (
      !isCancelled({ channelStatus: l.status, claimStatus: l.claimStatus }) &&
      !l.trackingNumber &&
      !l.dispatchedAt &&
      l.shippingDueAt &&
      l.shippingDueAt < now
    )
      v.E.push({
        ref: l.orderId,
        note: `${l.productName} · 출고기한 ${hours(l.shippingDueAt)}시간 경과`,
      })
  }

  if (!rule) {
    if (excel.length || eligible.length)
      v.C.push({ ref: '-', note: '매칭 키 규칙 미확정 — 엑셀 대조 불가' })
    return v
  }

  // 엑셀 주문 단위 그룹(분할·일대다 등록은 수량 합계)
  const groups = new Map<
    string,
    { qty: number; completed: boolean; targets: Array<string | null> }
  >()
  for (const e of excel.filter((x) => x.channelLinked)) {
    const k = normalizeOrderNumber(e.orderNumber)
    const g = groups.get(k) ?? { qty: 0, completed: true, targets: [] }
    g.qty += e.quantity
    g.completed &&= e.completed
    g.targets.push(...e.targets)
    groups.set(k, g)
  }
  const obsGroups = new Map<string, ObsLine[]>()
  for (const l of obs) {
    const k = keyOf(l, rule.field)
    obsGroups.set(k, [...(obsGroups.get(k) ?? []), l])
  }

  for (const [k, g] of groups) {
    const lines = obsGroups.get(k)
    if (!lines) {
      v.A.push({ ref: k, note: '엑셀에는 있으나 관측에 없음' })
      continue
    }
    const live = lines.filter(
      (l) => !isCancelled({ channelStatus: l.status, claimStatus: l.claimStatus })
    )
    if (live.length < lines.length && !g.completed) {
      v.D.push({ ref: lines[0].orderId, note: '채널 취소 — 엑셀 미완료 묶음에 남아 있음' })
    }
    if (live.length === 0) continue
    const obsQty = live.reduce((n, l) => n + l.quantity, 0)
    if (obsQty < g.qty)
      v.A.push({ ref: lines[0].orderId, note: `수량 합계 관측 ${obsQty} < 엑셀 ${g.qty}` })
    else if (obsQty > g.qty)
      v.C.push({ ref: lines[0].orderId, note: `수량 합계 관측 ${obsQty} > 엑셀 ${g.qty}` })
    else {
      const ot = live.map((l) => l.target)
      const sameSet =
        ot.every(Boolean) &&
        g.targets.every(Boolean) &&
        [...new Set(ot)].sort().join() === [...new Set(g.targets)].sort().join()
      if (!sameSet) v.C.push({ ref: lines[0].orderId, note: '상품 대응 불가 또는 모호' })
    }
  }

  // B 엑셀 등록 누락 후보
  for (const [k, lines] of obsGroups) {
    if (groups.has(k)) continue
    const live = lines.filter(
      (l) =>
        l.deliveryKind !== ARRIVAL_GUARANTEE &&
        !isCancelled({ channelStatus: l.status, claimStatus: l.claimStatus })
    )
    if (!live.length) continue
    const first = live.reduce((a, b) => (a.paidAt < b.paidAt ? a : b))
    if (oneBusinessDayAfter(first.paidAt) <= now)
      v.B.push({
        ref: first.orderId,
        note: `${first.productName} · 결제 후 ${hours(first.paidAt)}시간`,
      })
  }
  return v
}

export const counts = (v: Verdict) => ({
  A: v.A.length,
  B: v.B.length,
  C: v.C.length,
  D: v.D.length,
  E: v.E.length,
})

// ─── 키 진단 리포트 ───────────────────────────────────────────────────────────

export type DiagnoseReport = {
  observed: number
  excelTotal: number
  excelLinked: number
  excelUnlinked: number
  obsPatterns: Array<{ pattern: string; count: number }>
  excelPatterns: Array<{ pattern: string; count: number }>
  matchRates: Array<{ field: MatchField; matched: number; total: number }>
}

const top = (m: Map<string, number>, n = 5) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pattern, count]) => ({ pattern, count }))

/** 주문번호 원문·개인정보를 담지 않는다 — 패턴과 건수·일치율만. */
export function diagnose(input: {
  obs: ObsLine[]
  excel: Array<Pick<ExcelOrder, 'orderNumber' | 'channelLinked'>>
}): DiagnoseReport {
  const { obs, excel } = input
  const count = (vals: string[]) => {
    const m = new Map<string, number>()
    for (const v of vals) m.set(keyPattern(v), (m.get(keyPattern(v)) ?? 0) + 1)
    return top(m)
  }
  const excelSet = new Set(excel.map((e) => normalizeOrderNumber(e.orderNumber)))
  const fields: MatchField[] = ['externalOrderId', 'externalLineKey', 'lineKeyOrderPart']
  return {
    observed: obs.length,
    excelTotal: excel.length,
    excelLinked: excel.filter((e) => e.channelLinked).length,
    excelUnlinked: excel.filter((e) => !e.channelLinked).length,
    obsPatterns: count(obs.map((l) => l.orderId)),
    excelPatterns: count(excel.map((e) => e.orderNumber)),
    matchRates: fields.map((field) => {
      const vals = [...new Set(obs.map((l) => keyOf(l, field)))]
      return { field, total: vals.length, matched: vals.filter((x) => excelSet.has(x)).length }
    }),
  }
}
