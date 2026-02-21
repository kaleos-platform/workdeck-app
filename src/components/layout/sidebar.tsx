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
    <div className="flex h-full w-64 flex-shrink-0 flex-col space-y-4 bg-slate-900 py-4 text-white">
      {/* 로고 */}
      <div className="px-3 py-2">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 pl-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-orange-500 to-red-600">
            <BarChart2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-base leading-tight font-bold">
            쿠팡 광고
            <br />
            매니저
          </span>
        </Link>

        {/* 메인 메뉴 */}
        <div className="space-y-1">
          {mainRoutes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                'group flex w-full cursor-pointer justify-start rounded-lg p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                pathname === route.href ? 'bg-white/10 text-white' : 'text-zinc-400'
              )}
            >
              <route.icon className="mr-3 h-5 w-5 flex-shrink-0" />
              {route.label}
            </Link>
          ))}
        </div>

        {/* 캠페인 목록 구분선 */}
        <Separator className="my-4 bg-white/10" />

        {/* 캠페인 섹션 헤더 */}
        <div className="mb-2 flex items-center gap-2 px-3">
          <BarChart2 className="h-4 w-4 text-zinc-500" />
          <span className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
            캠페인
          </span>
        </div>

        {/* 캠페인 목록 */}
        <div className="space-y-1">
          {campaigns.length === 0 ? (
            <p className="px-3 py-2 text-xs text-zinc-600">업로드된 캠페인이 없습니다</p>
          ) : (
            campaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/dashboard/campaigns/${campaign.id}`}
                className={cn(
                  'group flex w-full cursor-pointer justify-start truncate rounded-lg p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white',
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
          className="w-full justify-start text-zinc-400 hover:bg-white/10 hover:text-white"
          onClick={signOut}
        >
          <LogOut className="mr-3 h-5 w-5" />
          로그아웃
        </Button>
      </div>
    </div>
  )
}
