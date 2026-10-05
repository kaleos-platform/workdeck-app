import { Badge } from '@/components/ui/badge'

export type PostingStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED'

export const STATUS_LABELS: Record<PostingStatus, string> = {
  DRAFT: '작성 중',
  ACTIVE: '발행됨',
  CLOSED: '마감',
  ARCHIVED: '보관',
}

// DRAFT=secondary, ACTIVE=emerald 쌍, CLOSED=neutral, ARCHIVED=ghost (DESIGN.md §3.2)
export function PostingStatusBadge({ status }: { status: PostingStatus }) {
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
  if (status === 'ARCHIVED') {
    return <Badge variant="ghost">{STATUS_LABELS.ARCHIVED}</Badge>
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
