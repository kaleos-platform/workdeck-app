import { Badge } from '@/components/ui/badge'

type Status = 'TODO' | 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'ANALYZED'

const LABEL: Record<Status, string> = {
  TODO: '할 일',
  DRAFT: '초안',
  IN_REVIEW: '검토 중',
  APPROVED: '승인',
  SCHEDULED: '예약됨',
  PUBLISHED: '게시됨',
  ANALYZED: '분석 완료',
}

const VARIANT: Record<Status, 'default' | 'outline' | 'secondary'> = {
  TODO: 'outline',
  DRAFT: 'outline',
  IN_REVIEW: 'secondary',
  APPROVED: 'default',
  SCHEDULED: 'secondary',
  PUBLISHED: 'default',
  ANALYZED: 'secondary',
}

export function ContentStatusBadge({ status }: { status: Status }) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}
