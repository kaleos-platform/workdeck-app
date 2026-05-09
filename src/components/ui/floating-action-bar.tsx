'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 다중 선택 가능한 목록에서 일괄 액션을 표시하는 하단 floating bar.
 * Linear/Notion 스타일 — 다크 배경, 화면 하단 중앙 고정, 슬라이드 인 애니메이션.
 *
 * 구조:
 *   <FloatingActionBar open onClear={...} actions={<액션 버튼들>}>
 *     <라벨 영역 (예: "N개 선택됨")>
 *   </FloatingActionBar>
 */
type FloatingActionBarProps = {
  open: boolean
  children: React.ReactNode
  actions: React.ReactNode
  onClear?: () => void
  clearDisabled?: boolean
  className?: string
}

export function FloatingActionBar({
  open,
  children,
  actions,
  onClear,
  clearDisabled,
  className,
}: FloatingActionBarProps) {
  if (!open) return null
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 duration-200">
      <div
        className={cn(
          'pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-border/40 bg-foreground/95 px-4 py-2.5 text-background shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-foreground/90',
          className
        )}
      >
        <div className="flex items-baseline gap-1.5">{children}</div>
        <div className="mx-1 h-5 w-px bg-background/20" />
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          {onClear && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-background/70 hover:bg-background/15 hover:text-background"
              onClick={onClear}
              disabled={clearDisabled}
              aria-label="선택 해제"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** 다크 floating bar 안의 일반 액션 버튼 className (Button과 함께 사용) */
export const floatingActionButtonClass =
  'h-8 text-background hover:bg-background/15 hover:text-background'

/** 다크 floating bar 안의 위험(삭제) 액션 버튼 className */
export const floatingActionButtonDestructiveClass =
  'h-8 text-red-300 hover:bg-red-500/20 hover:text-red-200 disabled:text-background/40'

/** 다크 floating bar 안의 Input className (시인성 확보) */
export const floatingActionInputClass =
  'h-8 border-background/20 bg-background/10 text-background placeholder:text-background/60 focus-visible:ring-background/40'

/** 다크 floating bar 안의 SelectTrigger className (시인성 확보) */
export const floatingActionSelectTriggerClass =
  'h-8 border-background/20 bg-background/10 text-background data-[placeholder]:text-background/60'
