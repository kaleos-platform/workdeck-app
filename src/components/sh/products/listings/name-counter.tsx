'use client'

// 상품명 글자수 표시. 세 폼(listing-form.tsx·listing-create-form.tsx·group-base-info-card.tsx)에
// 같은 컴포넌트가 중복 정의돼 있던 것을 합쳤다.

import { cn } from '@/lib/utils'

/** 공백 포함 글자 수. emoji surrogate 쌍은 이 도메인에서 고려하지 않는다. */
export function countChars(value: string): number {
  return value.length
}

export function NameCounter({
  value,
  limit,
  /**
   * 채널 가이드 상한이면 true — 넘겨도 저장은 된다는 뜻으로 "(가이드)"를 붙인다.
   * 관리용 상품명처럼 limit 이 실제 입력 상한(maxLength)과 같은 자리에서는 false 로 둬야 한다.
   * 하드 상한에 "(가이드)"를 붙이면 넘길 수 있다는 거짓말이 된다.
   */
  guide = false,
}: {
  value: string
  limit?: number
  guide?: boolean
}) {
  const count = countChars(value)
  const over = limit != null && count > limit
  return (
    <span
      className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}
    >
      {count}
      {limit != null ? ` / ${limit}${guide ? '(가이드)' : ''}` : ''}
    </span>
  )
}
