import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'
import './sales-content.css'

export default async function SalesContentLayout({ children }: { children: React.ReactNode }) {
  const { spaceName } = await requireDeckAccess('sales-content')

  return (
    <DeckShell workspaceName={spaceName} variant="sales-content" dataDeck="sales-content">
      {children}
    </DeckShell>
  )
}
