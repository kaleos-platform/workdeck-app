import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'
import { FINANCE_DECK_ID } from '@/lib/deck-routes'

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const { spaceName } = await requireDeckAccess(FINANCE_DECK_ID)

  return (
    <DeckShell workspaceName={spaceName} variant="finance">
      {children}
    </DeckShell>
  )
}
