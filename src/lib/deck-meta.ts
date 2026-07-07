import {
  LayoutGrid,
  BarChart2,
  ShoppingBag,
  Sparkles,
  Landmark,
  PenSquare,
  Briefcase,
  type LucideIcon,
} from 'lucide-react'
import {
  COUPANG_ADS_BASE_PATH,
  SELLER_HUB_BASE_PATH,
  SALES_CONTENT_BASE_PATH,
  FINANCE_DASHBOARD_PATH,
  RECRUITING_HOME_PATH,
  BLOG_OPS_HOME_PATH,
} from './deck-routes'

export type DeckVariant =
  | 'workdeck'
  | 'coupang-ads'
  | 'seller-hub'
  | 'sales-content'
  | 'finance'
  | 'recruiting'
  | 'blog-ops'

export type DeckMeta = {
  name: string
  href: string
  icon: LucideIcon
  /** 로고 아이콘 박스 배경 — tailwind 그라데이션 클래스 */
  gradient: string
}

/**
 * Deck variant별 브랜드 메타 단일 출처.
 * Sidebar 로고가 이 값을 사용한다 (이전에는 header.tsx에 흩어져 있었음).
 */
export const DECK_META: Record<DeckVariant, DeckMeta> = {
  'coupang-ads': {
    name: '쿠팡 광고 관리자',
    href: COUPANG_ADS_BASE_PATH,
    icon: BarChart2,
    gradient: 'from-orange-500 to-red-600',
  },
  'seller-hub': {
    name: '브랜드 운영',
    href: SELLER_HUB_BASE_PATH,
    icon: ShoppingBag,
    gradient: 'from-violet-500 to-purple-700',
  },
  'sales-content': {
    name: '세일즈 콘텐츠',
    href: SALES_CONTENT_BASE_PATH,
    icon: Sparkles,
    gradient: 'from-fuchsia-500 to-indigo-600',
  },
  finance: {
    name: '재무 관리',
    href: FINANCE_DASHBOARD_PATH,
    icon: Landmark,
    gradient: 'from-emerald-500 to-teal-600',
  },
  recruiting: {
    name: '모집 관리',
    href: RECRUITING_HOME_PATH,
    icon: Briefcase,
    gradient: 'from-sky-500 to-blue-700',
  },
  'blog-ops': {
    name: '블로그 운영',
    href: BLOG_OPS_HOME_PATH,
    icon: PenSquare,
    gradient: 'from-sky-500 to-cyan-600',
  },
  workdeck: {
    name: 'Workdeck',
    href: '/my-deck',
    icon: LayoutGrid,
    gradient: 'from-blue-600 to-cyan-500',
  },
}
