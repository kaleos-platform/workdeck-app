'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, UploadCloud, BarChart2, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { Separator } from '@/components/ui/separator'

const mainRoutes = [
  {
    label: '대시보드',
    icon: LayoutDashboard,
    href: '/dashboard',
  },
  {
    label: '리포트 업로드',
    icon: UploadCloud,
    href: '/dashboard/upload',
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const [campaigns, setCampaigns] = useState<{ id: string; name: string }[]>([])

  // 캠페인 목록을 API에서 불러오기
  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<{ id: string; name: string }>) => setCampaigns(list))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-4 py-4 flex flex-col h-full bg-slate-900 text-white w-64 flex-shrink-0">
      {/* 로고 */}
      <div className="px-3 py-2">
        <Link href="/dashboard" className="flex items-center gap-2 pl-3 mb-6">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center flex-shrink-0">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-base font-bold leading-tight">쿠팡 광고<br />매니저</span>
        </Link>

        {/* 메인 메뉴 */}
        <div className="space-y-1">
          {mainRoutes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                'text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition',
                pathname === route.href ? 'bg-white/10 text-white' : 'text-zinc-400'
              )}
            >
              <route.icon className="h-5 w-5 mr-3 flex-shrink-0" />
              {route.label}
            </Link>
          ))}
        </div>

        {/* 캠페인 목록 구분선 */}
        <Separator className="my-4 bg-white/10" />

        {/* 캠페인 섹션 헤더 */}
        <div className="flex items-center gap-2 px-3 mb-2">
          <BarChart2 className="h-4 w-4 text-zinc-500" />
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">캠페인</span>
        </div>

        {/* 캠페인 목록 */}
        <div className="space-y-1">
          {campaigns.length === 0 ? (
            <p className="text-xs text-zinc-600 px-3 py-2">
              업로드된 캠페인이 없습니다
            </p>
          ) : (
            campaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/dashboard/campaigns/${campaign.id}`}
                className={cn(
                  'text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition truncate',
                  pathname === `/dashboard/campaigns/${campaign.id}`
                    ? 'bg-white/10 text-white'
                    : 'text-zinc-400'
                )}
              >
                {campaign.name}
              </Link>
            ))
          )}
        </div>
      </div>

      {/* 하단 로그아웃 버튼 */}
      <div className="mt-auto px-3 py-2">
        <Button
          variant="ghost"
          className="w-full justify-start text-zinc-400 hover:text-white hover:bg-white/10"
          onClick={signOut}
        >
          <LogOut className="h-5 w-5 mr-3" />
          로그아웃
        </Button>
      </div>
    </div>
  )
}
