'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { formatTrialEndDate, trialDday } from './billing-shared'

const URGENT =
  'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400'

/**
 * 체험 종료까지 남은 날(D-n). D-3 이하는 주의(amber) + 「체험 종료 임박」.
 * reserved=구독 예약된 업무 — 종료일에 유료로 넘어가므로 경고 없이 「D-n 후 유료 전환」.
 */
export function TrialDdayBadge({
  trialEndsAt,
  reserved = false,
  className,
}: {
  trialEndsAt: string
  reserved?: boolean
  className?: string
}) {
  const dday = trialDday(trialEndsAt)
  if (!dday) return null
  const endDate = formatTrialEndDate(trialEndsAt)
  if (reserved) {
    return (
      <Badge
        variant="outline"
        className={cn('w-fit tabular-nums', className)}
        title={`${endDate}까지 체험, 다음 날부터 유료`}
      >
        {dday.label === 'D-Day' ? '내일부터 유료 전환' : `${dday.label} 후 유료 전환`}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn('w-fit tabular-nums', dday.urgent && URGENT, className)}
      title={`체험 마지막 날: ${endDate}`}
    >
      {dday.urgent ? `체험 종료 임박 · ${dday.label}` : dday.label}
    </Badge>
  )
}
