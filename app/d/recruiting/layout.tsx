import { requireDeckAccess } from '@/lib/billing/deck-layout-guard'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function RecruitingLayout({ children }: { children: React.ReactNode }) {
  const { spaceName } = await requireDeckAccess('recruiting')

  return (
    <DeckShell workspaceName={spaceName} variant="recruiting" dataDeck="recruiting">
      {children}
    </DeckShell>
  )
}
