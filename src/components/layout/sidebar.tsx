'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  UploadCloud,
  BarChart2,
  BarChart3,
  Play,
  LogOut,
  ChevronDown,
  Home,
  Settings,
  Package,
  ArrowLeftRight,
  MapPin,
  Store,
  FileCheck,
  Layers,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { Separator } from '@/components/ui/separator'
import { getLastNDaysRangeKst } from '@/lib/date-range'
import {
  COUPANG_ADS_BASE_PATH,
  COUPANG_ADS_UPLOAD_PATH,
  COUPANG_ADS_ANALYSIS_PATH,
  COUPANG_ADS_EXECUTION_PATH,
  COUPANG_ADS_SETTINGS_PATH,
  COUPANG_ADS_INVENTORY_PATH,
  getCoupangAdsCampaignPath,
  INVENTORY_MGMT_BASE_PATH,
  INVENTORY_MGMT_MOVEMENTS_PATH,
  INVENTORY_MGMT_PRODUCTS_PATH,
  INVENTORY_MGMT_LOCATIONS_PATH,
  INVENTORY_MGMT_CHANNELS_PATH,
  INVENTORY_MGMT_RECONCILIATION_PATH,
  INVENTORY_MGMT_REORDER_PATH,
  INVENTORY_MGMT_SETTINGS_PATH,
  INVENTORY_MGMT_STOCK_STATUS_PATH,
} from '@/lib/deck-routes'

type Campaign = {
  id: string
  name: string
  displayName: string
  isCustomName: boolean
  adTypes: string[]
}

type SidebarVariant = 'workdeck' | 'coupang-ads' | 'inventory-mgmt'

type SidebarProps = {
  workspaceName: string
  variant?: SidebarVariant
  mode?: 'default' | 'my-deck'
  activeDecks?: Array<{ id: string; name: string }>
}

const NVB_AD_TYPE = '신규 구매 고객 확보'
const DECK_ENTRY: Record<string, string> = {
  'coupang-ads': COUPANG_ADS_BASE_PATH,
  'inventory-mgmt': INVENTORY_MGMT_BASE_PATH,
}

const INVENTORY_MAIN_ROUTES = [
  {
    label: '대시보드',
    icon: LayoutDashboard,
    href: INVENTORY_MGMT_BASE_PATH,
  },
  {
    label: '입출고 관리',
    icon: ArrowLeftRight,
    href: INVENTORY_MGMT_MOVEMENTS_PATH,
  },
  {
    label: '재고 현황',
    icon: Layers,
    href: INVENTORY_MGMT_STOCK_STATUS_PATH,
  },
  {
    label: '상품 관리',
    icon: Package,
    href: INVENTORY_MGMT_PRODUCTS_PATH,
  },
  {
    label: '위치 관리',
    icon: MapPin,
    href: INVENTORY_MGMT_LOCATIONS_PATH,
  },
  {
    label: '채널 관리',
    icon: Store,
    href: INVENTORY_MGMT_CHANNELS_PATH,
  },
  {
    label: '재고 대조',
    icon: FileCheck,
    href: INVENTORY_MGMT_RECONCILIATION_PATH,
  },
  {
    label: '발주 예측',
    icon: TrendingUp,
    href: INVENTORY_MGMT_REORDER_PATH,
  },
  {
    label: '설정',
    icon: Settings,
    href: INVENTORY_MGMT_SETTINGS_PATH,
  },
]

const COUPANG_MAIN_ROUTES = [
  {
    label: '쿠팡 광고 홈',
    icon: LayoutDashboard,
    href: COUPANG_ADS_BASE_PATH,
  },
  {
    label: '데이터 수집',
    icon: UploadCloud,
    href: COUPANG_ADS_UPLOAD_PATH,
  },
  {
    label: '로켓그로스 재고',
    icon: Package,
    href: COUPANG_ADS_INVENTORY_PATH,
  },
  {
    label: '광고 분석',
    icon: BarChart3,
    href: COUPANG_ADS_ANALYSIS_PATH,
  },
  {
    label: '실행 관리',
    icon: Play,
    href: COUPANG_ADS_EXECUTION_PATH,
  },
  {
    label: '설정',
    icon: Settings,
    href: COUPANG_ADS_SETTINGS_PATH,
  },
]

function getDeckHref(deckId: string) {
  return DECK_ENTRY[deckId] ?? `/d/${deckId}`
}

export function Sidebar({
  workspaceName,
  variant = 'workdeck',
  mode = 'default',
  activeDecks = [],
}: SidebarProps) {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [collapsedAdTypes, setCollapsedAdTypes] = useState<Set<string>>(new Set())
  const isWorkdeckSidebar = variant === 'workdeck'
  const isCoupangSidebar = variant === 'coupang-ads'
  const isInventorySidebar = variant === 'inventory-mgmt'
  const isMyDeckMode = mode === 'my-deck'

  useEffect(() => {
    if (!isCoupangSidebar) return

    fetch('/api/campaigns')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Campaign[]) => setCampaigns(list))
      .catch(() => {})
  }, [pathname, isCoupangSidebar])

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

  function buildCampaignHref(campaign: Campaign): string {
    const basePath = getCoupangAdsCampaignPath(campaign.id)
    const isNvbCampaign = campaign.adTypes.some((type) => type.trim() === NVB_AD_TYPE)
    if (!isNvbCampaign) return basePath

    const { from, to } = getLastNDaysRangeKst(14)
    const query = new URLSearchParams({ from, to })
    return `${basePath}?${query.toString()}`
  }

  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col space-y-4 bg-slate-900 py-4 text-white">
      <div className="px-3 py-2">
        {isWorkdeckSidebar && (
          <>
            <div className="mb-2">
              <Link
                href="/my-deck"
                className={cn(
                  'group flex w-full cursor-pointer justify-start rounded-lg p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                  pathname === '/my-deck' ? 'bg-white/10 text-white' : 'text-zinc-400'
                )}
              >
                <Home className="mr-3 h-5 w-5 flex-shrink-0" />
                <span className="truncate">My Deck 홈</span>
              </Link>
            </div>

            <Separator className="mb-3 bg-white/10" />
            <section className="rounded-xl bg-white/[0.02] px-3 py-3">
              <div className="mb-3 px-1">
                <p className="text-xs font-semibold tracking-wide text-zinc-200 uppercase">
                  {workspaceName}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">사용 중인 Deck 빠른 진입</p>
              </div>
              {isMyDeckMode && activeDecks.length > 0 ? (
                <div className="space-y-1">
                  {activeDecks.map((deck) => {
                    const href = getDeckHref(deck.id)
                    const isDeckActive = pathname === href || pathname.startsWith(`${href}/`)

                    return (
                      <Link
                        key={deck.id}
                        href={href}
                        className={cn(
                          'group flex w-full cursor-pointer items-center justify-start truncate rounded-md px-3 py-2 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                          isDeckActive ? 'bg-white/10 text-white' : 'text-zinc-400'
                        )}
                      >
                        <span className="mr-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-600" />
                        <span className="truncate">{deck.name}</span>
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <p className="rounded-md px-1 py-2 text-xs text-zinc-500">
                  사용 중인 Deck이 없습니다
                </p>
              )}
            </section>
          </>
        )}

        {isInventorySidebar && (
          <div className="space-y-1">
            {INVENTORY_MAIN_ROUTES.map((route) => {
              const isHomeRoute = route.href === INVENTORY_MGMT_BASE_PATH
              const isActive = isHomeRoute
                ? pathname === route.href
                : pathname === route.href || pathname.startsWith(`${route.href}/`)
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  className={cn(
                    'group flex w-full cursor-pointer justify-start rounded-lg p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                    isActive ? 'bg-white/10 text-white' : 'text-zinc-400'
                  )}
                >
                  <route.icon className="mr-3 h-5 w-5 flex-shrink-0" />
                  <span className="truncate">{route.label}</span>
                </Link>
              )
            })}
          </div>
        )}

        {isCoupangSidebar && (
          <>
            <div className="space-y-1">
              {COUPANG_MAIN_ROUTES.map((route) => {
                const isHomeRoute = route.href === COUPANG_ADS_BASE_PATH
                const isActive = isHomeRoute
                  ? pathname === route.href
                  : pathname === route.href || pathname.startsWith(`${route.href}/`)
                return (
                  <Link
                    key={route.href}
                    href={route.href}
                    className={cn(
                      'group flex w-full cursor-pointer justify-start rounded-lg p-3 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                      isActive ? 'bg-white/10 text-white' : 'text-zinc-400'
                    )}
                  >
                    <route.icon className="mr-3 h-5 w-5 flex-shrink-0" />
                    <span className="truncate">{route.label}</span>
                  </Link>
                )
              })}
            </div>

            <Separator className="my-4 bg-white/10" />

            <section className="rounded-xl bg-white/[0.02] px-3 py-3">
              <div className="mb-3 px-1">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-zinc-300" />
                  <span className="text-xs font-semibold tracking-wide text-zinc-200 uppercase">
                    캠페인
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-zinc-500">광고 유형별 캠페인 관리</p>
              </div>

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
                              {items.map((campaign) => {
                                const campaignPath = getCoupangAdsCampaignPath(campaign.id)
                                const isCampaignActive =
                                  pathname === campaignPath ||
                                  pathname.startsWith(`${campaignPath}/`)

                                return (
                                  <Link
                                    key={`${adType}-${campaign.id}`}
                                    href={buildCampaignHref(campaign)}
                                    className={cn(
                                      'group flex w-full cursor-pointer items-center justify-start truncate rounded-md px-2 py-2 text-sm font-medium transition hover:bg-white/10 hover:text-white',
                                      isCampaignActive ? 'bg-white/10 text-white' : 'text-zinc-400'
                                    )}
                                  >
                                    <span className="mr-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-zinc-600" />
                                    <span className="truncate">
                                      {campaign.displayName || campaign.name}
                                    </span>
                                  </Link>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </section>
          </>
        )}
      </div>

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
