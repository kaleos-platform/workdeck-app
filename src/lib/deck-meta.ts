import {
  LayoutGrid,
  BarChart2,
  ShoppingBag,
  Sparkles,
  Landmark,
  Briefcase,
  type LucideIcon,
} from 'lucide-react'
import {
  COUPANG_ADS_BASE_PATH,
  SELLER_HUB_BASE_PATH,
  SALES_CONTENT_BASE_PATH,
  FINANCE_DASHBOARD_PATH,
  RECRUITING_HOME_PATH,
} from './deck-routes'

export type DeckVariant =
  | 'workdeck'
  | 'coupang-ads'
  | 'seller-hub'
  | 'sales-content'
  | 'finance'
  | 'recruiting'

export type DeckMeta = {
  name: string
  href: string
  icon: LucideIcon
  /** 로고 아이콘 박스 배경 — tailwind 그라데이션 클래스 */
  gradient: string
  /** 카드용 1문장 요약 — 마케팅 랜딩(hero.subcopy) 축약. workdeck variant는 없음 */
  description?: string
}

/**
 * Deck variant별 브랜드 메타 단일 출처.
 * Sidebar 로고가 이 값을 사용한다 (이전에는 header.tsx에 흩어져 있었음).
 */
export const DECK_META: Record<DeckVariant, DeckMeta> = {
  'coupang-ads': {
    name: '쿠팡 광고 관리',
    href: COUPANG_ADS_BASE_PATH,
    icon: BarChart2,
    gradient: 'from-orange-500 to-red-600',
    description:
      '쿠팡 광고 리포트를 업로드하면 캠페인별 ROAS·광고비·키워드 분석이 자동으로 정리됩니다.',
  },
  'seller-hub': {
    name: '브랜드 운영',
    href: SELLER_HUB_BASE_PATH,
    icon: ShoppingBag,
    gradient: 'from-violet-500 to-purple-700',
    description:
      '여러 판매 채널의 재고·발주를 한곳에서 관리하고, 가격 시뮬레이션으로 채널별 마진을 미리 계산합니다.',
  },
  'sales-content': {
    name: '세일즈 콘텐츠',
    href: SALES_CONTENT_BASE_PATH,
    icon: Sparkles,
    gradient: 'from-fuchsia-500 to-indigo-600',
    description:
      '상품과 타겟 페르소나 기반으로 콘텐츠 기획·제작·배포·성과 분석을 하나의 흐름으로 잇습니다.',
  },
  finance: {
    name: '재무 관리',
    href: FINANCE_DASHBOARD_PATH,
    icon: Landmark,
    gradient: 'from-emerald-500 to-teal-600',
    description:
      '은행·카드 거래내역을 업로드하면 자동 분류되고, 현금흐름·손익 대시보드로 자금 흐름을 확인합니다.',
  },
  recruiting: {
    name: '모집 관리',
    href: RECRUITING_HOME_PATH,
    icon: Briefcase,
    gradient: 'from-sky-500 to-blue-700',
    description:
      '채용 공고를 디자인 블록으로 꾸미고 지원자 접수·관리·블랙리스트까지 함께 처리합니다.',
  },
  workdeck: {
    name: 'Workdeck',
    href: '/my-deck',
    icon: LayoutGrid,
    gradient: 'from-blue-600 to-cyan-500',
  },
}
