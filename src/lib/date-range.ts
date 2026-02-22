// 한국 시간(KST, UTC+9) 기준 오늘 날짜 문자열
export function getTodayStrKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
}

// KST 기준 N일 전 날짜 문자열
export function getDaysAgoStrKst(offset: number): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 - offset * 86400 * 1000)
    .toISOString()
    .split('T')[0]
}

// 최근 N일(오늘 포함) 범위
export function getLastNDaysRangeKst(days: number): { from: string; to: string } {
  const safeDays = Math.max(1, Math.floor(days))
  return {
    from: getDaysAgoStrKst(safeDays - 1),
    to: getTodayStrKst(),
  }
}

// YYYY-MM-DD 형식 검증
export function isYmdDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

// Date 객체를 KST 기준 YYYY-MM-DD 문자열로 변환
export function formatDateToYmdKst(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().split('T')[0]
}
