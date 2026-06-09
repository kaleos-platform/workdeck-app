'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type SidebarItem = {
  label: string
  href: string
  disabled?: boolean
  badge?: string
}

type SidebarSectionProps = {
  label: string
  icon: LucideIcon
  items: SidebarItem[]
  /** 접힘(아이콘 레일) 상태 여부 */
  collapsed?: boolean
  /** 접힌 상태에서 그룹 아이콘 클릭 시 사이드바를 다시 펼친다 */
  onExpand?: () => void
}

export function SidebarSection({
  label,
  icon: Icon,
  items,
  collapsed = false,
  onExpand,
}: SidebarSectionProps) {
  const pathname = usePathname()
  const sectionIsActive = items.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )
  const [isOpen, setIsOpen] = useState(sectionIsActive)

  // ── 접힘(아이콘 레일) 상태: 아이콘만 표시, 클릭 시 사이드바 재확장 ──
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onExpand}
            aria-label={`${label} 펼치기`}
            className={cn(
              'flex w-full items-center justify-center rounded-lg p-3 transition',
              'text-zinc-400 hover:bg-white/10 hover:text-white',
              sectionIsActive && 'text-white'
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className={cn(
          'flex w-full items-center justify-between rounded-lg p-3 text-sm font-medium transition',
          'text-zinc-400 hover:bg-white/10 hover:text-white',
          sectionIsActive && 'text-zinc-200'
        )}
      >
        <span className="flex items-center gap-3">
          <Icon className="h-5 w-5 flex-shrink-0" />
          {label}
        </span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="mt-1 ml-4 space-y-0.5 border-l border-white/10 pl-3">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-zinc-600"
                  aria-disabled
                >
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {item.badge}
                    </span>
                  )}
                </div>
              )
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition',
                  'hover:bg-white/10 hover:text-white',
                  isActive ? 'bg-white/10 text-white' : 'text-zinc-400'
                )}
              >
                <span className="truncate">{item.label}</span>
                {item.badge && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
