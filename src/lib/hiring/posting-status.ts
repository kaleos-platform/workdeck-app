import { isHiringDeadlinePassed } from './closing-date'

export type PostingDisplayStatus = 'DRAFT' | 'OPEN' | 'CLOSED' | 'ARCHIVED'

export const DISPLAY_STATUS_LABELS: Record<PostingDisplayStatus, string> = {
  DRAFT: '작성 중',
  OPEN: '모집중',
  CLOSED: '마감',
  ARCHIVED: '보관',
}

/** 저장 상태 + 마감일 → 화면 상태. 발행(ACTIVE)이어도 마감일이 지났으면 마감. */
export function getPostingDisplayStatus(
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED',
  closingDate: Date | string | null | undefined,
  now = new Date()
): PostingDisplayStatus {
  if (status === 'DRAFT' || status === 'ARCHIVED' || status === 'CLOSED') return status
  const date = typeof closingDate === 'string' ? new Date(closingDate) : closingDate
  return isHiringDeadlinePassed(date, now) ? 'CLOSED' : 'OPEN'
}

function todayKstStartUtc(now: Date): Date {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now)
  return new Date(`${today}T00:00:00Z`)
}

/** 모집중 = 발행(ACTIVE) + 마감일 없음 또는 오늘(KST) 이후. */
export function openPostingWhere(now = new Date()) {
  return {
    status: 'ACTIVE' as const,
    OR: [{ closingDate: null }, { closingDate: { gte: todayKstStartUtc(now) } }],
  }
}

/** 마감 = 직접 마감(CLOSED) 또는 발행(ACTIVE)인데 마감일이 지남. */
export function closedPostingWhere(now = new Date()) {
  return {
    OR: [
      { status: 'CLOSED' as const },
      { status: 'ACTIVE' as const, closingDate: { lt: todayKstStartUtc(now) } },
    ],
  }
}
