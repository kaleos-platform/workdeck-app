import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { loadShellContext } from '@/lib/workspace-shell'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function MyDeckLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const shell = await loadShellContext(user.id)
  if (!shell) redirect('/workspace-setup')

  return (
    <DeckShell
      workspaceName={shell.workspaceName}
      variant="workdeck"
      mode="my-deck"
      isOwner={shell.isOwner}
      activeDecks={shell.activeDecks}
    >
      {children}
    </DeckShell>
  )
}
