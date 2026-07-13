'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

type ExpiryCountdownProps = {
  expiresAt: string
  className?: string
}

// PENDING 액션의 만료까지 남은 시간을 1분 간격으로 갱신 표시.
export function ExpiryCountdown({ expiresAt, className }: ExpiryCountdownProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const diffMs = new Date(expiresAt).getTime() - now
  const label = formatRemaining(diffMs)
  const isUrgent = diffMs > 0 && diffMs < 60 * 60 * 1000 // 1시간 미만

  return (
    <span
      className={cn(
        'text-xs',
        diffMs <= 0 ? 'text-destructive' : isUrgent ? 'text-amber-600' : 'text-muted-foreground',
        className
      )}
    >
      {label}
    </span>
  )
}

function formatRemaining(diffMs: number): string {
  if (diffMs <= 0) return '만료됨'

  const totalMinutes = Math.floor(diffMs / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}일 ${remHours}시간 후 만료`
  }
  if (hours >= 1) {
    return `${hours}시간 ${minutes}분 후 만료`
  }
  return `${minutes}분 후 만료`
}
