'use client'

import { AlertCircle, Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * 자동 저장 상태 표시용 chip. 그룹상품 상세와 상품 상세 화면에서 공용.
 *
 * 상태 우선순위:
 * 1. saving — "저장 중..."
 * 2. error  — "저장 실패 — 재시도"
 * 3. retryCount > 0 — "저장 시도 중... (n/3)"
 * 4. dirty — "저장 대기 중... (Nm건)"
 * 5. else — "저장됨"
 */
export function SaveStatusChip({
  saving,
  dirty,
  dirtyCount,
  error,
  retryCount,
  onRetry,
}: {
  saving: boolean
  dirty: boolean
  dirtyCount: number
  error: string | null
  retryCount: number
  onRetry: () => void
}) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        저장 중...
      </span>
    )
  }
  if (error) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="h-8 gap-1 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title={error}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        저장 실패 — 재시도
      </Button>
    )
  }
  if (retryCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin opacity-50" />
        저장 시도 중... ({retryCount}/3)
      </span>
    )
  }
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
        <Loader2 className="h-3.5 w-3.5 animate-spin opacity-50" />
        저장 대기 중... ({dirtyCount}건)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="h-3.5 w-3.5 text-emerald-600" />
      저장됨
    </span>
  )
}
