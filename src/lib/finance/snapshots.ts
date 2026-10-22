/**
 * 월말 잔고 스냅샷 파생 — 거래후잔액(balanceAfter)에서 계좌·월별 마지막 잔액을 뽑는다.
 * 커밋/삭제 후 DERIVED 스냅샷 재계산에 쓰는 순수 함수(단위 테스트 대상). DB I/O는 호출부에.
 */

/** Date → "YYYY-MM" (로컬). */
export function yearMonth(d: Date): string {
  // txnDate는 KST 벽시계를 UTC로 저장하는 규약(aggregate.ts ymOf 주석) → UTC getter로 읽는다.
  // 서버가 UTC인 prod에선 결과가 같지만, 로컬 dev(KST)에서 월말 거래가 다음 달로 새는 것을 막는다.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

type ChainTxn<B> = {
  txnDate: Date
  balanceAfter: B | null
  direction?: 'IN' | 'OUT'
  amount?: B
}

const cents = (v: unknown) => Math.round(Number(String(v)) * 100)

/**
 * txnDate 오름차순 정렬 + 같은 시각 거래는 잔액 체인 순서로.
 * 은행 export 는 초 단위라 통과성 입출금(같은 초 입금→출금)이 동률이 된다. DB 순서대로 두면
 * 중간 잔액이 월말·현재 잔액으로 잡힌다(prod: 디딤돌 7월 378,270 실제 0).
 * 동률 그룹은 직전 거래 잔액에서 시작해 "이 거래의 직전 잔액 = 앞 거래의 거래후잔액"으로 이어 붙인다.
 * 체인이 끝까지 안 이어지면(직전 잔액 미상·데이터 결손) 원래 순서를 유지한다.
 */
export function sortByBalanceChain<T extends ChainTxn<unknown>>(txns: T[]): T[] {
  const sorted = [...txns].sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime())
  const out: T[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1
    while (j < sorted.length && sorted[j].txnDate.getTime() === sorted[i].txnDate.getTime()) j++
    const group = sorted.slice(i, j)
    const anchor = out.length ? out[out.length - 1].balanceAfter : null
    out.push(
      ...(group.length > 1 ? chainGroup(group, anchor == null ? null : cents(anchor)) : group)
    )
    i = j
  }
  return out
}

function chainGroup<T extends ChainTxn<unknown>>(group: T[], anchor: number | null): T[] {
  if (group.some((t) => t.balanceAfter == null || t.direction == null || t.amount == null))
    return group
  const prev = (t: T) =>
    cents(t.balanceAfter) - (t.direction === 'IN' ? cents(t.amount) : -cents(t.amount))
  // 앞 거래가 없으면(조회 범위의 첫 그룹) 다른 거래의 거래후잔액이 아닌 직전 잔액이 하나뿐일 때 그것이 시작점.
  if (anchor == null) {
    const afters = new Set(group.map((t) => cents(t.balanceAfter)))
    const starts = group.map(prev).filter((p) => !afters.has(p))
    if (starts.length !== 1) return group
    anchor = starts[0]
  }
  const rest = [...group]
  const chained: T[] = []
  let cur = anchor
  while (rest.length) {
    const k = rest.findIndex((t) => prev(t) === cur)
    if (k < 0) return group
    const [next] = rest.splice(k, 1)
    chained.push(next)
    cur = cents(next.balanceAfter)
  }
  return chained
}

/**
 * 거래 목록에서 계좌의 월말 잔고를 파생한다.
 *   - 월별 마지막 거래(sortByBalanceChain 순서)의 balanceAfter를 그 달의 잔고로 본다.
 *   - balanceAfter가 null인 거래는 무시(은행 외 계좌).
 *   - manualMonths에 포함된 달은 사용자 수기 입력(MANUAL)이므로 파생에서 제외(보존).
 * 동률 정렬에 direction·amount 가 필요하다 — 빠지면 같은 시각 거래는 입력 순서를 따른다.
 */
export function deriveMonthEndSnapshots<B>(
  txns: ChainTxn<B>[],
  manualMonths: ReadonlySet<string> = new Set()
): { yearMonth: string; balance: B }[] {
  const ordered = sortByBalanceChain(txns)
  const lastByMonth = new Map<string, B>()
  for (const t of ordered) {
    if (t.balanceAfter == null) continue
    lastByMonth.set(yearMonth(t.txnDate), t.balanceAfter)
  }
  const out: { yearMonth: string; balance: B }[] = []
  for (const [ym, balance] of lastByMonth) {
    if (manualMonths.has(ym)) continue
    out.push({ yearMonth: ym, balance })
  }
  return out
}
