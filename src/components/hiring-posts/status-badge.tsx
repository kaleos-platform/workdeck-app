import { Badge } from '@/components/ui/badge'
import { getPostingDisplayStatus } from '@/lib/hiring/posting-status'

// 저장 상태 타입. Prisma enum에 폐지된 ARCHIVED 값이 남아 있어 타입에만 포함하며 화면에는 쓰지 않는다(마감으로 표시).
export type PostingStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'

export const STATUS_LABELS: Record<Exclude<PostingStatus, 'ARCHIVED'>, string> = {
  DRAFT: '작성 중',
  ACTIVE: '모집중',
  CLOSED: '마감',
}

// DRAFT=secondary, ACTIVE=emerald 쌍, CLOSED=neutral (DESIGN.md §3.2)
// closingDate 를 주면 마감일이 지난 발행 공고를 「마감」으로 표시한다.
export function PostingStatusBadge({
  status: stored,
  closingDate,
}: {
  status: PostingStatus
  closingDate?: Date | string | null
}) {
  const display = getPostingDisplayStatus(stored, closingDate)
  const status = display === 'OPEN' ? 'ACTIVE' : display
  if (status === 'ACTIVE') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-300 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/40 dark:text-emerald-400"
      >
        {STATUS_LABELS.ACTIVE}
      </Badge>
    )
  }
  if (status === 'CLOSED') {
    return (
      <Badge
        variant="outline"
        className="border-slate-400 bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
      >
        {STATUS_LABELS.CLOSED}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-400 bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      {STATUS_LABELS.DRAFT}
    </Badge>
  )
}
