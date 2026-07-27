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
            // 전역 비활성(DeckApp.isActive=false) deck은 설치돼 있어도 노출 금지.
            // 구 분리형 hiring-posts/hiring-applicants가 recruiting으로 통합된 뒤
            // orphan DeckInstance로 남아 my-deck에 새어나오던 문제 차단.
            where: { isActive: true, deckApp: { isActive: true } },
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
