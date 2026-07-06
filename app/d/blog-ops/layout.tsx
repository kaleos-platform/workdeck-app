import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { resolveDeckContext } from '@/lib/api-helpers'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function BlogOpsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/login')

  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) redirect('/my-deck')

  return (
    <DeckShell workspaceName={resolved.space.name} variant="blog-ops" dataDeck="blog-ops">
      {children}
    </DeckShell>
  )
}
