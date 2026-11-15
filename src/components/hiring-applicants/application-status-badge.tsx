// 지원자 상태 배지 — `{채용 단계} · {결과}` 한 개. 색은 결과 기준(DESIGN §2.2 배지 조합).
import { Badge } from '@/components/ui/badge'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/application-shared'
import type { HiringApplicationStage, HiringProcessStage } from '@/generated/prisma/client'

const CLASS: Record<HiringApplicationStage, string> = {
  HIRING:
    'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400',
  ACCEPTED:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400',
  REJECTED:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400',
}

export function ApplicationStatusBadge({
  stage,
  hiringStage,
}: {
  stage: HiringApplicationStage
  hiringStage: HiringProcessStage
}) {
  return (
    <Badge variant="outline" className={CLASS[stage]}>
      {PROCESS_STAGE_LABELS[hiringStage]} · {STAGE_LABELS[stage]}
    </Badge>
  )
}
