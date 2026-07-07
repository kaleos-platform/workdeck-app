// 지원자 상태 배지 — DESIGN §3.2 시맨틱 색 라이트/다크 쌍.
import { Badge } from '@/components/ui/badge'
import { STAGE_LABELS, PROCESS_STAGE_LABELS } from '@/lib/hiring/application-shared'
import type { HiringApplicationStage, HiringProcessStage } from '@/generated/prisma/client'

const STAGE_CLASS: Record<HiringApplicationStage, string> = {
  HIRING: 'border-blue-200 bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-400',
  ACCEPTED:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  REJECTED: 'border-red-200 bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400',
}

export function StageBadge({ stage }: { stage: HiringApplicationStage }) {
  return (
    <Badge variant="outline" className={STAGE_CLASS[stage]}>
      {STAGE_LABELS[stage]}
    </Badge>
  )
}

export function ProcessStageBadge({ stage }: { stage: HiringProcessStage }) {
  return (
    <Badge variant="secondary" className="text-xs">
      {PROCESS_STAGE_LABELS[stage]}
    </Badge>
  )
}

export function DuplicatedBadge() {
  return (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
    >
      중복
    </Badge>
  )
}

export function BlacklistBadge() {
  return (
    <Badge
      variant="outline"
      className="border-red-200 bg-red-50 text-red-700 dark:bg-red-900 dark:text-red-400"
    >
      블랙리스트
    </Badge>
  )
}
