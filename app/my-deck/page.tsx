import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { MyDeckClient } from '@/components/my-deck/my-deck-client'

export default async function MyDeckPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id },
    include: {
      space: {
        select: {
          id: true,
          name: true,
          deckInstances: {
            where: { isActive: true },
            include: {
              deckApp: {
                select: { id: true, name: true, description: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  })

  if (!membership) redirect('/workspace-setup')

  const { space } = membership
  const activeDeckIds = space.deckInstances.map((instance) => instance.deckApp.id)

  const availableDecks = await prisma.deckApp.findMany({
    where:
      activeDeckIds.length > 0
        ? {
            isActive: true,
            id: { notIn: activeDeckIds },
          }
        : { isActive: true },
    select: { id: true, name: true, description: true },
    orderBy: { name: 'asc' },
  })

  return (
    <MyDeckClient
      spaceName={space.name}
      activeDecks={space.deckInstances.map((instance) => instance.deckApp)}
      availableDecks={availableDecks}
    />
  )
}
