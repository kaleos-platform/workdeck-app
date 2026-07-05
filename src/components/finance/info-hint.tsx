'use client'

/** 작은 ⓘ 아이콘 + 툴팁 안내. 분류(매출/원가·판관비·금융, 고정/변동) 가이드에 사용. */
import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function InfoHint({ content, className }: { content: ReactNode; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="설명"
            className={cn('text-muted-foreground/70 hover:text-foreground', className)}
            onClick={(e) => e.stopPropagation()}
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] p-2.5 text-left leading-relaxed break-keep [text-wrap:wrap]">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
