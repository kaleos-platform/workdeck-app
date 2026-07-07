// 포스트 상태 배지 공유 설정

export type BoPostStatus =
  | 'GENERATING'
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'PUBLISH_APPROVED'
  | 'PUBLISHED'
  | 'FAILED'
  | 'ARCHIVED'

export const POST_STATUS_LABEL: Record<BoPostStatus, string> = {
  GENERATING: '생성 중',
  DRAFT: '초안',
  IN_REVIEW: '검토 중',
  PUBLISH_APPROVED: '발행 승인',
  PUBLISHED: '발행됨',
  FAILED: '실패',
  ARCHIVED: '보관',
}

export const POST_STATUS_CLASS: Record<BoPostStatus, string> = {
  GENERATING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  DRAFT: 'bg-secondary text-secondary-foreground',
  IN_REVIEW: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  PUBLISH_APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  PUBLISHED: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800/60 dark:text-emerald-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  ARCHIVED: 'bg-secondary text-secondary-foreground',
}

export function PostStatusBadge({ status }: { status: BoPostStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${POST_STATUS_CLASS[status]}`}
    >
      {status === 'PUBLISHED' && <span className="mr-1">●</span>}
      {POST_STATUS_LABEL[status]}
    </span>
  )
}
