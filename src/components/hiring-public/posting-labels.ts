// 공개 공고 표시용 라벨/포맷 유틸(무인증 페이지에서 사용 — PII·내부값 없음).

export const JOB_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: '정규직',
  PART_TIME: '아르바이트',
  CONTRACT: '계약직',
  FREELANCER: '프리랜서',
  INTERN: '인턴',
}

export const PAY_FREQUENCY_LABELS: Record<string, string> = {
  HOURLY: '시급',
  DAILY: '일급',
  WEEKLY: '주급',
  MONTHLY: '월급',
  YEARLY: '연봉',
  PER_TASK: '건당',
  TBD: '협의',
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export function formatPay(frequency?: string | null, amount?: number | null): string {
  const freq = frequency ? (PAY_FREQUENCY_LABELS[frequency] ?? frequency) : null
  if (amount == null) return freq ?? '협의'
  const won = `${amount.toLocaleString('ko-KR')}원`
  return freq ? `${freq} ${won}` : won
}

export function formatWorkDays(days?: unknown): string | null {
  if (!Array.isArray(days) || days.length === 0) return null
  const labels = days
    .filter((d): d is number => typeof d === 'number' && d >= 0 && d <= 6)
    .map((d) => WEEKDAYS[d])
  return labels.length ? labels.join('·') : null
}

export function formatWorkTime(start?: string | null, end?: string | null): string | null {
  if (!start && !end) return null
  if (start && end) return `${start} ~ ${end}`
  return start ?? end ?? null
}

/** hiring-assets(public 버킷) export PNG 공개 URL */
export function hiringAssetPublicUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return `${base}/storage/v1/object/public/hiring-assets/${path}`
}
