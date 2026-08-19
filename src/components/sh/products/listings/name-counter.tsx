'use client'

// 상품명 글자수 표시. 세 폼(listing-form.tsx·listing-create-form.tsx·group-base-info-card.tsx)에
// 같은 컴포넌트가 중복 정의돼 있던 것을 합쳤다.

import { cn } from '@/lib/utils'

/** 공백 포함 글자 수. emoji surrogate 쌍은 이 도메인에서 고려하지 않는다. */
export function countChars(value: string): number {
  return value.length
}

export function NameCounter({ value, limit }: { value: string; limit?: number }) {
  const count = countChars(value)
  const over = limit != null && count > limit
  return (
    <span
      className={cn('text-xs tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}
    >
      {count}
      {limit != null ? ` / ${limit}` : ''}
    </span>
  )
}
