import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function CoupangAdsLayout({ children }: { children: React.ReactNode }) {
  const { spaceName } = await requireDeckAccess('coupang-ads')

  return (
    <DeckShell workspaceName={spaceName} variant="coupang-ads">
      {children}
    </DeckShell>
  )
}
