/**
 * 재무 관리 Deck — 현금흐름 집계 공통 유틸(대시보드·현금흐름 상세 공유).
 *
 * 현금주의 집계 규칙:
 *   - isTransfer(계좌간 이체) 거래는 수입/지출에서 제외.
 *   - 카드 취소(cancelFlag '취소')는 부호 반전 → 해당 월 지출을 상계.
 *   - 잔고 스냅샷은 거래 없는 달엔 직전 값 이월(carry-forward, 읽기 시점 계산).
 */

export type AggRow = {
  txnDate: Date
  direction: 'IN' | 'OUT'
  amount: number
  isTransfer: boolean
  cancelFlag?: string | null
  categoryId?: string | null
}

/** Date → "YYYY-MM" (UTC getter).
 *
 * 【저장 규약】txnDate는 KST 벽시계 자릿수를 UTC로 저장한다(commit-staging toDate가 TZ 없는
 * 로컬 ISO 문자열로 new Date() 처리 → Vercel=UTC 환경에서 UTC 인스턴트로 저장).
 * 따라서 UTC getter로 읽으면 KST 달력 월이 그대로 복원된다. +9h 변환 불필요·금지.
 *
 * 【주의】현재 시각(new Date())은 진짜 UTC 인스턴트이므로 ymOf(new Date())는 틀림.
 * 현재 KST 월이 필요할 때는 nowYmKst()를 사용한다.
 */
export function ymOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 현재 KST 기준 "YYYY-MM".
 * KST = UTC+9이므로 +9h 후 UTC getter로 읽는다.
 * ymOf(new Date()) 대신 이 함수를 쓸 것 — Vercel UTC 서버에서 자정~09시에 이전 달로 틀림.
 */
export function nowYmKst(): string {
  return ymOf(new Date(Date.now() + 9 * 60 * 60 * 1000))
}

function parseYm(ym: string): { y: number; m: number } {
  const [y, m] = ym.split('-').map(Number)
  return { y, m }
}

/** "YYYY-MM" + delta(개월) → "YYYY-MM". */
export function addMonths(ym: string, delta: number): string {
  const { y, m } = parseYm(ym)
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}

/** 단일 월의 [gte, lt) 경계. */
export function monthBounds(ym: string): { gte: Date; lt: Date } {
  const { y, m } = parseYm(ym)
  return { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) }
}

/** [fromYm, toYm] 포함 범위의 [gte, lt) 경계. */
export function rangeBounds(fromYm: string, toYm: string): { gte: Date; lt: Date } {
  return { gte: monthBounds(fromYm).gte, lt: monthBounds(toYm).lt }
}

/** fromYm..toYm 포함하는 "YYYY-MM" 목록. */
export function monthList(fromYm: string, toYm: string): string[] {
  const out: string[] = []
  let cur = fromYm
  // 최대 120개월 안전장치
  for (let i = 0; i < 120 && cur <= toYm; i++) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

function isCancel(cancelFlag?: string | null): boolean {
  return !!cancelFlag && cancelFlag.includes('취소')
}

/** 취소 부호 반영 금액(취소면 음수). */
export function signedAmount(row: Pick<AggRow, 'amount' | 'cancelFlag'>): number {
  return isCancel(row.cancelFlag) ? -row.amount : row.amount
}

export type MonthAgg = { income: number; expense: number }

/** 거래 집합을 월별 수입/지출로 집계(이체 제외, 취소 상계). */
export function aggregateByMonth(rows: AggRow[]): Map<string, MonthAgg> {
  const map = new Map<string, MonthAgg>()
  for (const r of rows) {
    if (r.isTransfer) continue
    const ym = ymOf(r.txnDate)
    const cur = map.get(ym) ?? { income: 0, expense: 0 }
    const amt = signedAmount(r)
    if (r.direction === 'IN') cur.income += amt
    else cur.expense += amt
    map.set(ym, cur)
  }
  return map
}

/** 거래 집합을 계정과목(categoryId)별 지출로 집계(이체 제외, 취소 상계). null categoryId는 '__none'. */
export function aggregateExpenseByCategory(rows: AggRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.isTransfer || r.direction !== 'OUT') continue
    const key = r.categoryId ?? '__none'
    map.set(key, (map.get(key) ?? 0) + signedAmount(r))
  }
  return map
}

/** 거래 집합을 계정과목별 수입으로 집계. */
export function aggregateIncomeByCategory(rows: AggRow[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.isTransfer || r.direction !== 'IN') continue
    const key = r.categoryId ?? '__none'
    map.set(key, (map.get(key) ?? 0) + signedAmount(r))
  }
  return map
}
