// 마감일은 날짜값이므로 한국 시간 기준 해당 날짜가 끝날 때까지 접수한다.
export function isHiringDeadlinePassed(
  closingDate: Date | null | undefined,
  now = new Date()
): boolean {
  if (!closingDate) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  return closingDate.toISOString().slice(0, 10) < today
}

/** 기본 마감일(KST 오늘 + 14일) 'YYYY-MM-DD' — 상시 모집을 해제할 때 복원값으로 쓴다. */
export function defaultClosingDateStr(now = new Date()): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  const date = new Date(`${today}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 14)
  return date.toISOString().slice(0, 10)
}
