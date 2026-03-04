import { redirect } from 'next/navigation'

// deckKey → 실제 앱 경로 매핑
const DECK_ROUTES: Record<string, string> = {
  'coupang-ads': '/dashboard',
}

export default async function DeckEntryPage({ params }: { params: Promise<{ deckKey: string }> }) {
  const { deckKey } = await params
  const target = DECK_ROUTES[deckKey] ?? '/my-deck'
  redirect(target)
}
