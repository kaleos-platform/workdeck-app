/**
 * 월말 잔고 스냅샷 파생 — 거래후잔액(balanceAfter)에서 계좌·월별 마지막 잔액을 뽑는다.
 * 커밋/삭제 후 DERIVED 스냅샷 재계산에 쓰는 순수 함수(단위 테스트 대상). DB I/O는 호출부에.
 */

/** Date → "YYYY-MM" (로컬). */
export function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 거래 목록에서 계좌의 월말 잔고를 파생한다.
 *   - 월별 마지막(txnDate 최대) 거래의 balanceAfter를 그 달의 잔고로 본다.
 *   - balanceAfter가 null인 거래는 무시(은행 외 계좌).
 *   - manualMonths에 포함된 달은 사용자 수기 입력(MANUAL)이므로 파생에서 제외(보존).
 * 입력 순서에 의존하지 않도록 내부에서 txnDate 오름차순 정렬한다.
 */
export function deriveMonthEndSnapshots<B>(
  txns: { txnDate: Date; balanceAfter: B | null }[],
  manualMonths: ReadonlySet<string> = new Set()
): { yearMonth: string; balance: B }[] {
  const ordered = [...txns].sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime())
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
