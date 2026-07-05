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
  Truck,
  Boxes,
  FileText,
  Lightbulb,
  ClipboardList,
  Rocket,
  TrendingUp,
  ListChecks,
  FolderTree,
  Landmark,
  PanelLeftClose,
  PanelLeftOpen,
  Briefcase,
  Store,
  Tags,
  Users,
  UserX,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getLastNDaysRangeKst } from '@/lib/date-range'
import {
  COUPANG_ADS_BASE_PATH,
  COUPANG_ADS_UPLOAD_PATH,
  COUPANG_ADS_ANALYSIS_PATH,
  COUPANG_ADS_EXECUTION_PATH,
  COUPANG_ADS_SETTINGS_PATH,
  COUPANG_ADS_INVENTORY_PATH,
  getCoupangAdsCampaignPath,
  SELLER_HUB_BASE_PATH,
  SELLER_HUB_HOME_PATH,
  SELLER_HUB_SALES_ANALYTICS_PATH,
  SELLER_HUB_SETTINGS_PATH,
  SELLER_HUB_PRODUCTS_LIST_PATH,
  SELLER_HUB_BRANDS_PATH,
  SELLER_HUB_PRICING_SIM_PATH,
  SELLER_HUB_LISTINGS_PATH,
  SELLER_HUB_PRODUCTION_PATH,
  SELLER_HUB_STOCK_STATUS_PATH,
  SELLER_HUB_MOVEMENTS_PATH,
  SELLER_HUB_LOCATIONS_PATH,
  SELLER_HUB_RECONCILIATION_PATH,
  SELLER_HUB_REORDER_PATH,
  SELLER_HUB_SHIPPING_REGISTRATION_PATH,
  SELLER_HUB_SHIPPING_ORDERS_PATH,
  SELLER_HUB_SHIPPING_METHODS_PATH,
  SELLER_HUB_SETTINGS_INTEGRATION_PATH,
  SELLER_HUB_CHANNELS_PATH,
  SALES_CONTENT_BASE_PATH,
  SALES_CONTENT_HOME_PATH,
  SALES_CONTENT_IDEATION_PATH,
  SALES_CONTENT_CONTENTS_PATH,
  SALES_CONTENT_TEMPLATES_PATH,
  SALES_CONTENT_DEPLOYMENTS_PATH,
  SALES_CONTENT_ANALYTICS_PATH,
  SALES_CONTENT_SETTINGS_PATH,
  FINANCE_DASHBOARD_PATH,
  FINANCE_CASHFLOW_PATH,
  FINANCE_TRANSACTIONS_PATH,
  FINANCE_UPLOAD_PATH,
  FINANCE_ACCOUNTS_PATH,
  FINANCE_BALANCES_PATH,
  HIRING_POSTS_HOME_PATH,
  HIRING_POSTS_POSTINGS_PATH,
  HIRING_POSTS_TEMPLATES_PATH,
  HIRING_POSTS_STORES_PATH,
  HIRING_POSTS_POSITIONS_PATH,
  HIRING_APPLICANTS_HOME_PATH,
  HIRING_APPLICANTS_LIST_PATH,
  HIRING_APPLICANTS_BLACKLIST_PATH,
  HIRING_APPLICANTS_TEMPLATES_PATH,
} from '@/lib/deck-routes'
import { SidebarSection, type SidebarItem } from './sidebar-section'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'

type Campaign = {
  id: string
  name: string
  displayName: string
  isCustomName: boolean
  adTypes: string[]
}

type SidebarProps = {
  workspaceName: string
  variant?: DeckVariant
  mode?: 'default' | 'my-deck'
  activeDecks?: Array<{ id: string; name: string }>
}

const NVB_AD_TYPE = '신규 구매 고객 확보'
const DECK_ENTRY: Record<string, string> = {
  'coupang-ads': COUPANG_ADS_BASE_PATH,
  'seller-hub': SELLER_HUB_BASE_PATH,
  'sales-content': SALES_CONTENT_BASE_PATH,
}

// ─── Seller Hub 메뉴 데이터 ───────────────────────────────────────────────────
const SELLER_HUB_PRODUCTS_ITEMS: SidebarItem[] = [
  { label: '상품 목록', href: SELLER_HUB_PRODUCTS_LIST_PATH },
  { label: '가격 시뮬레이션', href: SELLER_HUB_PRICING_SIM_PATH },
  { label: '판매채널 상품', href: SELLER_HUB_LISTINGS_PATH },
  { label: '생산 관리', href: SELLER_HUB_PRODUCTION_PATH },
]

const SELLER_HUB_INVENTORY_ITEMS: SidebarItem[] = [
  { label: '재고 현황', href: SELLER_HUB_STOCK_STATUS_PATH },
  { label: '입출고 관리', href: SELLER_HUB_MOVEMENTS_PATH },
  { label: '위치 관리', href: SELLER_HUB_LOCATIONS_PATH },
  { label: '재고 조정', href: SELLER_HUB_RECONCILIATION_PATH },
  { label: '발주 계획', href: SELLER_HUB_REORDER_PATH },
]

const SELLER_HUB_SHIPPING_ITEMS: SidebarItem[] = [
  { label: '배송 등록', href: SELLER_HUB_SHIPPING_REGISTRATION_PATH },
  { label: '배송 데이터', href: SELLER_HUB_SHIPPING_ORDERS_PATH },
  { label: '배송 방식', href: SELLER_HUB_SHIPPING_METHODS_PATH },
]

// "설정" 섹션 — 채널 관리 + 데이터 연동 + 일반 설정을 한 곳으로 통합
const SELLER_HUB_SETTINGS_ITEMS: SidebarItem[] = [
  { label: '채널 관리', href: SELLER_HUB_CHANNELS_PATH },
  { label: '브랜드', href: SELLER_HUB_BRANDS_PATH },
  { label: '데이터 연동', href: SELLER_HUB_SETTINGS_INTEGRATION_PATH },
  { label: '일반 설정', href: SELLER_HUB_SETTINGS_PATH },
]

// ─── Sales Content 평탄 메뉴 데이터 (PR-A: 7항목 재구성) ────────────────────
const SALES_CONTENT_FLAT_ROUTES = [
  { label: '홈', icon: Home, href: SALES_CONTENT_HOME_PATH },
  { label: '아이데이션', icon: Lightbulb, href: SALES_CONTENT_IDEATION_PATH },
  { label: '콘텐츠 관리', icon: ClipboardList, href: SALES_CONTENT_CONTENTS_PATH },
  { label: '배포 내역', icon: Rocket, href: SALES_CONTENT_DEPLOYMENTS_PATH },
  { label: '성과 관리', icon: BarChart3, href: SALES_CONTENT_ANALYTICS_PATH },
  { label: '템플릿 관리', icon: FileText, href: SALES_CONTENT_TEMPLATES_PATH },
  { label: '설정', icon: Settings, href: SALES_CONTENT_SETTINGS_PATH },
]

// ─── 재무 관리 평탄 메뉴 데이터 (5섹션 + 도메인 탭 금지) ───────────────────────
const FINANCE_FLAT_ROUTES = [
  { label: '요약 대시보드', icon: LayoutDashboard, href: FINANCE_DASHBOARD_PATH },
  { label: '현금흐름 상세', icon: TrendingUp, href: FINANCE_CASHFLOW_PATH },
  { label: '거래 내역', icon: ListChecks, href: FINANCE_TRANSACTIONS_PATH },
  { label: '데이터 등록', icon: UploadCloud, href: FINANCE_UPLOAD_PATH },
  { label: '계정과목 관리', icon: FolderTree, href: FINANCE_ACCOUNTS_PATH },
  { label: '계좌 관리', icon: Landmark, href: FINANCE_BALANCES_PATH },
]

// ─── 채용 관리 평탄 메뉴 데이터 (도메인 탭 금지 규칙 준수) ─────────────────────
const HIRING_POSTS_FLAT_ROUTES = [
  { label: '홈', icon: Home, href: HIRING_POSTS_HOME_PATH },
  { label: '공고 관리', icon: Briefcase, href: HIRING_POSTS_POSTINGS_PATH },
  { label: '상세 템플릿', icon: FileText, href: HIRING_POSTS_TEMPLATES_PATH },
  { label: '매장 관리', icon: Store, href: HIRING_POSTS_STORES_PATH },
  { label: '직무 관리', icon: Tags, href: HIRING_POSTS_POSITIONS_PATH },
]

const HIRING_APPLICANTS_FLAT_ROUTES = [
  { label: '홈', icon: Home, href: HIRING_APPLICANTS_HOME_PATH },
  { label: '지원자', icon: Users, href: HIRING_APPLICANTS_LIST_PATH },
  { label: '블랙리스트', icon: UserX, href: HIRING_APPLICANTS_BLACKLIST_PATH },
  { label: '메시지 템플릿', icon: MessageSquare, href: HIRING_APPLICANTS_TEMPLATES_PATH },
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

/**
 * 펼침/접힘 두 상태를 모두 처리하는 네비게이션 링크.
 * 접힘 시 아이콘만 표시하고 hover 툴팁으로 라벨을 노출한다.
 */
function RailLink({
  href,
  icon: Icon,
  label,
  isActive,
  collapsed,
  size = 'md',
}: {
  href: string
  icon: LucideIcon
  label: string
  isActive: boolean
  collapsed: boolean
  size?: 'md' | 'sm'
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={href}
            aria-label={label}
            className={cn(
              'group flex w-full cursor-pointer items-center justify-center rounded-lg p-3 transition hover:bg-white/10 hover:text-white',
              isActive ? 'bg-white/10 text-white' : 'text-zinc-400'
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Link
      href={href}
      className={cn(
        'group flex w-full cursor-pointer justify-start rounded-lg text-sm font-medium transition hover:bg-white/10 hover:text-white',
        size === 'sm' ? 'px-2 py-2' : 'p-3',
        isActive ? 'bg-white/10 text-white' : 'text-zinc-400'
      )}
    >
      <Icon className={cn('flex-shrink-0', size === 'sm' ? 'mr-2.5 h-4 w-4' : 'mr-3 h-5 w-5')} />
      <span className="truncate">{label}</span>
    </Link>
  )
}

export function Sidebar({
  workspaceName,
  variant = 'workdeck',
  mode = 'default',
  activeDecks = [],
}: SidebarProps) {
  const pathname = usePathname()
  const { signOut } = useAuth()
  const { collapsed, toggle, expand, mounted } = useSidebarCollapsed()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [collapsedAdTypes, setCollapsedAdTypes] = useState<Set<string>>(new Set())
  const isWorkdeckSidebar = variant === 'workdeck'
  const isCoupangSidebar = variant === 'coupang-ads'
  const isSellerHubSidebar = variant === 'seller-hub'
  const isSalesContentSidebar = variant === 'sales-content'
  const isFinanceSidebar = variant === 'finance'
  const isHiringPostsSidebar = variant === 'hiring-posts'
  const isHiringApplicantsSidebar = variant === 'hiring-applicants'
  const isMyDeckMode = mode === 'my-deck'
  const meta = DECK_META[variant]
  const BrandIcon = meta.icon

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

  const expandedWidth = isSalesContentSidebar ? 'w-56' : 'w-64'

  return (
    <div
      className={cn(
        'flex h-full flex-shrink-0 flex-col bg-slate-900 py-4 text-white ease-out',
        // 마운트 후에만 transition 적용 — 저장된 접힘 상태 복원 시 width 튐 방지
        mounted && 'transition-[width] duration-200',
        collapsed ? 'w-16' : expandedWidth
      )}
    >
      {/* 상단: 접힘 시 펼치기 토글만 / 펼침 시 [로고 … 접기 토글] */}
      <div
        className={cn(
          'flex flex-shrink-0 items-center border-b border-white/5 px-3 pb-3',
          collapsed ? 'justify-center' : 'justify-between gap-2'
        )}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={toggle}
            aria-label="사이드바 펼치기"
            aria-expanded={false}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
        ) : (
          <>
            <Link
              href={meta.href}
              aria-label={`${meta.name} 홈으로 이동`}
              className="flex min-w-0 items-center gap-2"
            >
              <div
                className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br',
                  meta.gradient
                )}
              >
                <BrandIcon className="h-5 w-5 text-white" />
              </div>
              <span className="truncate text-sm leading-tight font-bold text-white">
                {meta.name}
              </span>
            </Link>
            <button
              type="button"
              onClick={toggle}
              aria-label="사이드바 접기"
              aria-expanded={true}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-2',
          collapsed ? 'px-2' : 'px-3'
        )}
      >
        {isWorkdeckSidebar && (
          <>
            <div className="mb-2">
              <RailLink
                href="/my-deck"
                icon={Home}
                label="My Deck 홈"
                isActive={pathname === '/my-deck'}
                collapsed={collapsed}
              />
            </div>

            {!collapsed && (
              <>
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
          </>
        )}

        {isSellerHubSidebar && (
          <div className="space-y-2">
            {/* 홈 */}
            <RailLink
              href={SELLER_HUB_HOME_PATH}
              icon={Home}
              label="홈"
              isActive={pathname === SELLER_HUB_HOME_PATH}
              collapsed={collapsed}
            />
            {/* 판매분석 */}
            <RailLink
              href={SELLER_HUB_SALES_ANALYTICS_PATH}
              icon={BarChart3}
              label="판매분석"
              isActive={pathname === SELLER_HUB_SALES_ANALYTICS_PATH}
              collapsed={collapsed}
            />
            {/* 섹션 그룹 */}
            <SidebarSection
              label="상품"
              icon={Package}
              items={SELLER_HUB_PRODUCTS_ITEMS}
              collapsed={collapsed}
              onExpand={expand}
            />
            <SidebarSection
              label="재고"
              icon={Boxes}
              items={SELLER_HUB_INVENTORY_ITEMS}
              collapsed={collapsed}
              onExpand={expand}
            />
            <SidebarSection
              label="배송"
              icon={Truck}
              items={SELLER_HUB_SHIPPING_ITEMS}
              collapsed={collapsed}
              onExpand={expand}
            />
            {/* 설정 섹션 — 채널 관리 + 일반 설정 통합 */}
            <SidebarSection
              label="설정"
              icon={Settings}
              items={SELLER_HUB_SETTINGS_ITEMS}
              collapsed={collapsed}
              onExpand={expand}
            />
          </div>
        )}

        {isSalesContentSidebar && (
          <div className="space-y-0.5">
            {SALES_CONTENT_FLAT_ROUTES.map((route) => {
              // 설정 항목: /settings/* 또는 기존 /channels, /rules 에서도 active
              const isSettingsRoute = route.href === SALES_CONTENT_SETTINGS_PATH
              const isActive = isSettingsRoute
                ? pathname.startsWith(SALES_CONTENT_SETTINGS_PATH)
                : route.href === SALES_CONTENT_HOME_PATH
                  ? pathname === route.href
                  : pathname === route.href || pathname.startsWith(`${route.href}/`)
              return (
                <RailLink
                  key={route.href}
                  href={route.href}
                  icon={route.icon}
                  label={route.label}
                  isActive={isActive}
                  collapsed={collapsed}
                  size="sm"
                />
              )
            })}
          </div>
        )}

        {isFinanceSidebar && (
          <div className="space-y-0.5">
            {FINANCE_FLAT_ROUTES.map((route) => {
              const isHomeRoute = route.href === FINANCE_DASHBOARD_PATH
              const isActive = isHomeRoute
                ? pathname === route.href
                : pathname === route.href || pathname.startsWith(`${route.href}/`)
              return (
                <RailLink
                  key={route.href}
                  href={route.href}
                  icon={route.icon}
                  label={route.label}
                  isActive={isActive}
                  collapsed={collapsed}
                  size="sm"
                />
              )
            })}
          </div>
        )}

        {isHiringPostsSidebar && (
          <div className="space-y-0.5">
            {HIRING_POSTS_FLAT_ROUTES.map((route) => {
              const isHomeRoute = route.href === HIRING_POSTS_HOME_PATH
              const isActive = isHomeRoute
                ? pathname === route.href
                : pathname === route.href || pathname.startsWith(`${route.href}/`)
              return (
                <RailLink
                  key={route.href}
                  href={route.href}
                  icon={route.icon}
                  label={route.label}
                  isActive={isActive}
                  collapsed={collapsed}
                  size="sm"
                />
              )
            })}
          </div>
        )}

        {isHiringApplicantsSidebar && (
          <div className="space-y-0.5">
            {HIRING_APPLICANTS_FLAT_ROUTES.map((route) => {
              const isHomeRoute = route.href === HIRING_APPLICANTS_HOME_PATH
              const isActive = isHomeRoute
                ? pathname === route.href
                : pathname === route.href || pathname.startsWith(`${route.href}/`)
              return (
                <RailLink
                  key={route.href}
                  href={route.href}
                  icon={route.icon}
                  label={route.label}
                  isActive={isActive}
                  collapsed={collapsed}
                  size="sm"
                />
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
                  <RailLink
                    key={route.href}
                    href={route.href}
                    icon={route.icon}
                    label={route.label}
                    isActive={isActive}
                    collapsed={collapsed}
                  />
                )
              })}
            </div>

            {!collapsed && (
              <>
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
                                          isCampaignActive
                                            ? 'bg-white/10 text-white'
                                            : 'text-zinc-400'
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
          </>
        )}
      </div>

      <div
        className={cn('flex-shrink-0 border-t border-white/5 py-2', collapsed ? 'px-2' : 'px-3')}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-full text-zinc-400 hover:bg-white/10 hover:text-white"
                onClick={signOut}
                aria-label="로그아웃"
              >
                <LogOut className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">로그아웃</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            variant="ghost"
            className="w-full justify-start text-zinc-400 hover:bg-white/10 hover:text-white"
            onClick={signOut}
          >
            <LogOut className="mr-3 h-5 w-5" />
            로그아웃
          </Button>
        )}
      </div>
    </div>
  )
}
