// 마감일은 날짜값이므로 한국 시간 기준 해당 날짜가 끝날 때까지 접수한다.
export function isHiringDeadlinePassed(
  closingDate: Date | null | undefined,
  now = new Date()
): boolean {
  if (!closingDate) return false
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  return closingDate.toISOString().slice(0, 10) < today
}
