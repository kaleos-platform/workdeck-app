import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
        className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-900/40 dark:text-emerald-400"
      >
        {STATUS_LABELS.ACTIVE}
      </Badge>
    )
  }
  if (status === 'CLOSED') {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground')}>
        {STATUS_LABELS.CLOSED}
      </Badge>
    )
  }
  if (status === 'ARCHIVED') {
    return <Badge variant="ghost">{STATUS_LABELS.ARCHIVED}</Badge>
  }
  return <Badge variant="secondary">{STATUS_LABELS.DRAFT}</Badge>
}
