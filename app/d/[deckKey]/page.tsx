import { redirect } from 'next/navigation'
import {
  COUPANG_ADS_BASE_PATH,
  SELLER_HUB_BASE_PATH,
  SALES_CONTENT_BASE_PATH,
} from '@/lib/deck-routes'

// deckKey → 실제 앱 경로 매핑
const DECK_ROUTES: Record<string, string> = {
  'coupang-ads': COUPANG_ADS_BASE_PATH,
  'seller-hub': SELLER_HUB_BASE_PATH,
  'sales-content': SALES_CONTENT_BASE_PATH,
}

export default async function DeckEntryPage({ params }: { params: Promise<{ deckKey: string }> }) {
  const { deckKey } = await params
  const target = DECK_ROUTES[deckKey] ?? '/my-deck'
  redirect(target)
}
