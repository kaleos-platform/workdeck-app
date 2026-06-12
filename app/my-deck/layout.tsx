import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { DeckShell } from '@/components/layout/deck-shell'

export default async function MyDeckLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()

  if (!user) {
    redirect('/login')
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
