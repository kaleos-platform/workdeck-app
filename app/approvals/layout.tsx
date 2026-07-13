import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { DeckShell } from '@/components/layout/deck-shell'
import { APPROVALS_PATH } from '@/lib/deck-routes'

// 승인 큐는 전역(space-wide) 페이지 — workdeck 셸(사이드바)을 그대로 사용한다.
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  if (!user) {
    redirect(`/login?redirectTo=${encodeURIComponent(APPROVALS_PATH)}`)
  }

  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({
      where: { ownerId: user.id },
      select: { id: true, name: true },
    }),
    prisma.spaceMember.findFirst({
      where: { userId: user.id },
      select: {
        spaceId: true,
        space: {
          select: {
            deckInstances: {
              where: { isActive: true },
              include: {
                deckApp: {
                  select: { id: true, name: true },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    }),
  ])

  if (!workspace) {
    redirect('/workspace-setup')
  }

  return (
    <DeckShell
      workspaceName={workspace.name}
      variant="workdeck"
      mode="my-deck"
      activeDecks={membership?.space.deckInstances.map(({ deckApp }) => deckApp) ?? []}
    >
      {children}
    </DeckShell>
  )
}
