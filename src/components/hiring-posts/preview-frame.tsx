'use client'

import { useState, type ReactNode } from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'

// 공고 미리보기 폭 기준: PC = 공개 페이지와 동일(640px), 모바일 = 표준(375px).
export const PREVIEW_PC_WIDTH = 640
export const PREVIEW_MOBILE_WIDTH = 375

type PreviewMode = 'pc' | 'mobile'

type Props = {
  children: ReactNode
  /** 토글 우측/상단에 함께 둘 부가 요소(예: 새 탭 열기 버튼) */
  actions?: ReactNode
  className?: string
}

// 미리보기 컨테이너 — PC/모바일 폭 토글 + 중앙 정렬 폭 캡.
export function PreviewFrame({ children, actions, className }: Props) {
  const [mode, setMode] = useState<PreviewMode>('pc')

  return (
    <div className={cn('space-y-3', className)}>
      {/* 툴바를 미리보기 영역 폭(현재 모드 폭)에 맞춰 중앙 정렬 — 토글은 가운데,
          부가 액션(새 탭 미리보기)은 미리보기 영역 우측 끝에 정렬. */}
      <div
        className="relative mx-auto flex w-full justify-center transition-[max-width] duration-200"
        style={{ maxWidth: mode === 'pc' ? PREVIEW_PC_WIDTH : PREVIEW_MOBILE_WIDTH }}
      >
        <div className="inline-flex items-center rounded-md border bg-muted/40 p-0.5">
          <button
            type="button"
            onClick={() => setMode('pc')}
            aria-pressed={mode === 'pc'}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition',
              mode === 'pc'
                ? 'bg-background font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Monitor className="size-3.5" /> PC
          </button>
          <button
            type="button"
            onClick={() => setMode('mobile')}
            aria-pressed={mode === 'mobile'}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs transition',
              mode === 'mobile'
                ? 'bg-background font-medium shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Smartphone className="size-3.5" /> 모바일
          </button>
        </div>
        {actions && <div className="absolute top-1/2 right-0 -translate-y-1/2">{actions}</div>}
      </div>

      <div
        className="mx-auto w-full transition-[max-width] duration-200"
        style={{ maxWidth: mode === 'pc' ? PREVIEW_PC_WIDTH : PREVIEW_MOBILE_WIDTH }}
      >
        {children}
      </div>
    </div>
  )
}
