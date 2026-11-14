import type { PostingStatus } from './status-badge'

const DAY_MS = 86_400_000

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

// 연장 가능한 공고: 발행된 공고(접수 중·마감)이면서 마감일이 있는 경우만.
export function canExtendDeadline(posting: {
  status: PostingStatus
  closingDate: string | null
}): boolean {
  return (posting.status === 'ACTIVE' || posting.status === 'CLOSED') && !!posting.closingDate
}

// 새 마감일 최소값 = 오늘(KST)과 현재 마감일 다음 날 중 늦은 날, 기본값 = 현재 마감일 +7일(최소값 이상).
export function getExtendDateBounds(closingDate: string, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  const current = closingDate.slice(0, 10)
  const next = addDays(current, 1)
  const min = next > today ? next : today
  const plus7 = addDays(current, 7)
  return { min, defaultDate: plus7 > min ? plus7 : min }
}

// 마감일 연장 API 호출 — 공고 상세와 목록 행 메뉴가 같은 경로를 쓴다.
export async function extendPosting(
  postingId: string,
  closingDate: string
): Promise<{ status: PostingStatus; closingDate: string | null }> {
  const res = await fetch(`/api/hiring-posts/postings/${postingId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'extend', closingDate }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message ?? '처리에 실패했습니다')
  }
  const { posting } = await res.json()
  return posting
}
