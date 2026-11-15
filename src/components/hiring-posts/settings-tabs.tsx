'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { RECRUITING_POSITIONS_PATH, RECRUITING_STORES_PATH } from '@/lib/deck-routes'
import { cn } from '@/lib/utils'

const TABS = [
  { label: '매장 관리', href: RECRUITING_STORES_PATH },
  { label: '직무 관리', href: RECRUITING_POSITIONS_PATH },
]

// 모집 관리 설정 탭 — 경로 기반 링크(지원자 상태 탭과 같은 밑줄 스타일)
export function SettingsTabs() {
  const pathname = usePathname()
  return (
    <nav aria-label="설정" className="flex flex-wrap gap-1 border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
