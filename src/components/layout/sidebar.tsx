'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, UploadCloud, BarChart2, LogOut, ChevronDown } from 'lucide-react'
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

type Campaign = {
  id: string
  name: string
  displayName: string
  isCustomName: boolean
  adTypes: string[]
}

export function Sidebar() {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [collapsedAdTypes, setCollapsedAdTypes] = useState<Set<string>>(new Set())

  // pathname 변경(업로드 완료 등) 시마다 캠페인 목록 재조회
  useEffect(() => {
    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Campaign[]) => setCampaigns(list))
      .catch(() => {})
  }, [pathname])

  const groupedCampaigns = useMemo(() => {
    const grouped = campaigns.reduce<Record<string, Campaign[]>>((acc, campaign) => {
      const normalizedTypes =
        campaign.adTypes.length > 0
          ? campaign.adTypes.map((type) => type.trim() || '기타')
          : ['기타']

      const uniqueTypes = Array.from(new Set(normalizedTypes))
      uniqueTypes.forEach((adType) => {
        if (!acc[adType]) {
          acc[adType] = []
        }
        acc[adType].push(campaign)
      })

      return acc
    }, {})

    return Object.entries(grouped)
      .map(([adType, items]) => ({
        adType,
        items: items
          .slice()
          .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'ko')),
      }))
      .sort((a, b) => a.adType.localeCompare(b.adType, 'ko'))
  }, [campaigns])

  const toggleAdType = (adType: string) => {
    setCollapsedAdTypes((prev) => {
      const next = new Set(prev)
      if (next.has(adType)) {
        next.delete(adType)
      } else {
        next.add(adType)
      }
      return next
    })
  }

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

        <section className="rounded-xl bg-white/[0.02] px-3 py-3">
          {/* 캠페인 섹션 헤더 */}
          <div className="mb-3 px-1">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-zinc-300" />
              <span className="text-xs font-semibold tracking-wide text-zinc-200 uppercase">
                캠페인
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500">광고 유형별 캠페인 관리</p>
          </div>

          {/* 캠페인 목록 (광고유형별 그룹핑) */}
          <div className="space-y-3">
            {groupedCampaigns.length === 0 ? (
              <p className="rounded-md px-1 py-2 text-xs text-zinc-500">
                업로드된 캠페인이 없습니다
              </p>
            ) : (
              groupedCampaigns.map(({ adType, items }) => {
                const isOpen = !collapsedAdTypes.has(adType)
                const contentId = `ad-type-${encodeURIComponent(adType)}`

                return (
                  <div key={adType} className="rounded-md bg-black/10 px-1 py-1">
                    <button
                      type="button"
                      onClick={() => toggleAdType(adType)}
                      aria-expanded={isOpen}
                      aria-controls={contentId}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-white/5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold tracking-wide text-zinc-300 uppercase">
                          {adType}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-zinc-300">
                          {items.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            'h-4 w-4 text-zinc-500 transition-transform',
                            isOpen && 'rotate-180'
                          )}
                        />
                      </div>
                    </button>

                    {isOpen && (
                      <div id={contentId} className="mx-1 mb-1 pl-2">
                        <div className="space-y-1 pt-1">
                          {items.map((campaign) => (
                            <Link
                              key={`${adType}-${campaign.id}`}
                              href={`/dashboard/campaigns/${campaign.id}`}
                              className={cn(
                                'group flex w-full cursor-pointer items-center justify-start truncate rounded-md px-2 py-2 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                                pathname === `/dashboard/campaigns/${campaign.id}`
                                  ? 'bg-white/10 text-white'
                                  : 'text-zinc-400'
                              )}
                            >
                              <span className="mr-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-600" />
                              <span className="truncate">
                                {campaign.displayName || campaign.name}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>
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
