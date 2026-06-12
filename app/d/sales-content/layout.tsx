import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { DeckShell } from '@/components/layout/deck-shell'
import './sales-content.css'

export default async function SalesContentLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <DeckShell workspaceName={resolved.space.name} variant="sales-content" dataDeck="sales-content">
      {children}
    </DeckShell>
  )
}
