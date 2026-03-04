import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'

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
    <div className="flex h-screen flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          workspaceName={workspace.name}
          spaceId={membership?.spaceId}
          mode="my-deck"
          activeDecks={membership?.space.deckInstances.map(({ deckApp }) => deckApp) ?? []}
        />
        <main className="flex-1 overflow-y-auto">
          <div className="p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
