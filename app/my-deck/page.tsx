import { redirect } from 'next/navigation'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { MyDeckClient } from '@/components/my-deck/my-deck-client'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import { resolveEntitlement } from '@/lib/billing/entitlement'

function findMembership(where: { userId: string; spaceId?: string }) {
  return prisma.spaceMember.findFirst({
    where,
    select: {
      role: true,
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
}

export default async function MyDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ spaceId?: string | string[] }>
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  // 초대 수락 후 /my-deck?spaceId=… 로 들어온다 — 그 Space 구성원이면 그 Space를 보여준다.
  // 구성원이 아니면 기존처럼 첫 멤버십. (여러 Space 선택 UI는 후속)
  const { spaceId } = await searchParams
  const requested = typeof spaceId === 'string' && spaceId ? spaceId : undefined
  // 비구성원 요청(forbidden)은 403 대신 기본 Space로 돌아간다.
  let current = await resolveCurrentMembership(user.id, requested)
  if (current && 'forbidden' in current) current = await resolveCurrentMembership(user.id)
  if (!current || 'forbidden' in current) redirect('/workspace-setup')

  const membership = await findMembership({ userId: user.id, spaceId: current.space.id })
  if (!membership) redirect('/workspace-setup')

  const { space } = membership
  const activeDeckIds = space.deckInstances.map((instance) => instance.deckApp.id)

  // 구독 해제 버튼은 실제로 과금 중인 업무에만 노출한다.
  // Trial·면제·무료 베타는 해제할 구독 아이템이 없어 cancelDeck이 404를 낸다.
  const subscription = await prisma.spaceSubscription.findUnique({
    where: { spaceId: space.id },
    select: {
      status: true,
      items: {
        where: { type: 'DECK', status: 'ACTIVE' },
        select: { deckAppId: true },
      },
    },
  })
  const subscribedDeckIds = subscription?.items.map((item) => item.deckAppId) ?? []

  // 유료 업무를 추가하려면 구독이 선행되어야 한다. 클라이언트가 추가 전에
  // 구독 확인 모달을 띄울지 판단할 수 있도록 가격·결제수단·접근권한을 함께 내린다.
  const [entitlement, billingProducts, billingMethod] = await Promise.all([
    resolveEntitlement(space.id),
    prisma.billingDeckProduct.findMany({
      where: { isActive: true },
      select: { id: true, name: true, pricingMode: true, monthlyPrice: true },
    }),
    prisma.billingMethod.findFirst({
      where: { spaceId: space.id, isDefault: true },
      select: { cardSummary: true },
    }),
  ])

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
      subscribedDeckIds={subscribedDeckIds}
      isOwner={membership.role === 'OWNER'}
      cardSummary={billingMethod?.cardSummary ?? null}
      hasActiveSubscription={subscription?.status === 'ACTIVE'}
      billing={billingProducts.map((product) => ({
        id: product.id,
        pricingMode: product.pricingMode,
        monthlyPrice: product.monthlyPrice,
        allowed: entitlement.decks[product.id]?.allowed ?? false,
      }))}
    />
  )
}
