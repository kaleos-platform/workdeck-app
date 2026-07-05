/**
 * 부채(FinLiability) 상환 감지 — 순수 집계.
 *
 * 감지 규칙: 부채에 "연결된" 상환 거래(liabilityId 지정) 중,
 * 아직 잔액에 반영되지 않은 것(txnDate > 워터마크)만 집계한다.
 * 워터마크 = balanceAsOf ?? createdAt (생성 시점까지의 상환은 입력 잔액에 이미 반영됨).
 *
 * 계정과목/금액 휴리스틱은 쓰지 않는다 — 연결은 사용자 주도, 확정도 사용자 몫.
 */

export type RepaymentTxn = {
  liabilityId: string | null
  amount: number
  txnDate: Date
  direction: 'IN' | 'OUT'
}

export type LiabilityWatermark = {
  id: string
  balanceAsOf: Date | null
  createdAt: Date
}

export type LiabilityPending = {
  count: number
  sum: number
  /** 반영 시 워터마크로 쓸, 감지된 상환 중 가장 늦은 거래일(ISO). 없으면 null */
  throughDate: string | null
}

/** balanceAsOf 우선, 없으면 createdAt 을 워터마크로 사용 */
export function watermarkOf(l: LiabilityWatermark): Date {
  return l.balanceAsOf ?? l.createdAt
}

/**
 * 부채별로 "미반영 상환"을 집계한다.
 * - 상환 = 부채에 연결된 OUT 거래(잔액을 줄이는 현금 유출).
 * - 워터마크 이후(txnDate > watermark) 거래만 대상.
 */
export function computeLiabilityPending(
  liabilities: LiabilityWatermark[],
  repayments: RepaymentTxn[]
): Map<string, LiabilityPending> {
  const wm = new Map(liabilities.map((l) => [l.id, watermarkOf(l)]))
  const acc = new Map<string, { count: number; sum: number; latest: Date | null }>()
  for (const l of liabilities) acc.set(l.id, { count: 0, sum: 0, latest: null })

  for (const t of repayments) {
    if (!t.liabilityId || t.direction !== 'OUT') continue
    const watermark = wm.get(t.liabilityId)
    if (!watermark) continue // 이 부채는 대상 목록에 없음
    if (!(t.txnDate > watermark)) continue // 이미 반영됨
    const cur = acc.get(t.liabilityId)!
    cur.count += 1
    cur.sum += t.amount
    if (!cur.latest || t.txnDate > cur.latest) cur.latest = t.txnDate
  }

  const out = new Map<string, LiabilityPending>()
  for (const [id, v] of acc) {
    out.set(id, {
      count: v.count,
      sum: Math.round(v.sum * 100) / 100,
      throughDate: v.latest ? v.latest.toISOString() : null,
    })
  }
  return out
}
