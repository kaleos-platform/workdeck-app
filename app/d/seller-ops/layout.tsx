import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function SellerHubLayout({ children }: { children: React.ReactNode }) {
  await requireDeckAccess('seller-hub')

  return <DeckShell variant="seller-hub">{children}</DeckShell>
}
