import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { DECK_META, type DeckVariant } from '@/lib/deck-meta'

export function AdminDeckContext({ deck }: { deck: Exclude<DeckVariant, 'workdeck'> }) {
  return (
    <nav
      aria-label="업무 관리 경로"
      className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
    >
      <Link href="/admin/decks" className="hover:text-foreground hover:underline">
        업무 관리
      </Link>
      <ChevronRight className="size-3.5" aria-hidden="true" />
      <span>{DECK_META[deck].name}</span>
    </nav>
  )
}
