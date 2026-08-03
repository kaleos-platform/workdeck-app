import {
  UploadCloud,
  LineChart,
  Search,
  RefreshCw,
  LayoutGrid,
  GitBranch,
  Landmark,
  Tag,
  FileText,
  Palette,
  Inbox,
  MessageSquare,
  ShieldAlert,
  Store,
  Users,
  Lightbulb,
  LayoutTemplate,
  Send,
  BarChart3,
  Box,
  Truck,
  Package,
  TrendingUp,
  Calculator,
  ShoppingBag,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

/**
 * deck 랜딩 데이터(`src/lib/marketing/decks/*.ts`)의 `features[].icon` 문자열 키 →
 * lucide 아이콘 매핑. 새 deck 데이터에 아이콘 키를 추가하면 여기에도 등록한다.
 * 미등록 키는 FALLBACK_ICON으로 대체된다.
 */
export const FEATURE_ICONS: Record<string, LucideIcon> = {
  upload: UploadCloud,
  chart: LineChart,
  search: Search,
  refresh: RefreshCw,
  grid: LayoutGrid,
  'git-branch': GitBranch,
  landmark: Landmark,
  tag: Tag,
  'file-text': FileText,
  palette: Palette,
  inbox: Inbox,
  'message-square': MessageSquare,
  'shield-alert': ShieldAlert,
  store: Store,
  users: Users,
  lightbulb: Lightbulb,
  'layout-template': LayoutTemplate,
  send: Send,
  'bar-chart': BarChart3,
  box: Box,
  truck: Truck,
  package: Package,
  'trending-up': TrendingUp,
  calculator: Calculator,
  'shopping-bag': ShoppingBag,
}

const FALLBACK_ICON: LucideIcon = Sparkles

export function getFeatureIcon(icon: string): LucideIcon {
  return FEATURE_ICONS[icon] ?? FALLBACK_ICON
}
