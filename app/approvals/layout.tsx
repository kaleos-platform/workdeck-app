import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { loadShellContext } from '@/lib/workspace-shell'
import { DeckShell } from '@/components/layout/deck-shell'
import { APPROVALS_PATH } from '@/lib/deck-routes'

// 승인 큐는 전역(space-wide) 페이지 — workdeck 셸(사이드바)을 그대로 사용한다.
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(APPROVALS_PATH)}`)
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
