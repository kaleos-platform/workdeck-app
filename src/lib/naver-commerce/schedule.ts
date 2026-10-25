// N배송 수집 일정: 최근 N일은 매번 재수집(취소·반품 반영), 과거는 커서(backfilledThrough)부터 청크 단위 백필.

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function daysToSync(
  today: string,
  store: { startDate: string; backfilledThrough: string | null },
  opts?: { recent?: number; backfillChunk?: number }
): string[] {
  const recent = opts?.recent ?? 7
  const chunk = opts?.backfillChunk ?? 7
  const yesterday = addDays(today, -1)
  const recentStart = addDays(yesterday, -recent + 1)
  const days = new Set<string>()
  for (
    let d = recentStart < store.startDate ? store.startDate : recentStart;
    d <= yesterday;
    d = addDays(d, 1)
  )
    days.add(d)
  let d = addDays(store.backfilledThrough ?? addDays(store.startDate, -1), 1)
  for (let i = 0; i < chunk && d < recentStart; i++, d = addDays(d, 1)) days.add(d)
  return [...days].sort()
}

export function advanceCursor(
  prev: string | null,
  startDate: string,
  attempted: string[],
  ok: Set<string>
): string | null {
  const tried = new Set(attempted)
  let cursor = prev
  for (
    let d = addDays(prev ?? addDays(startDate, -1), 1);
    tried.has(d) && ok.has(d);
    d = addDays(d, 1)
  )
    cursor = d
  return cursor
}
