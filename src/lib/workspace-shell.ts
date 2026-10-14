import { prisma } from '@/lib/prisma'

/**
 * workdeck 셸(사이드바) 공용 로딩 — settings·my-deck·approvals layout.
 * Workspace 소유 또는 Space 구성원이면 셸을 만든다(초대로 합류한 구성원은 Workspace가 없다).
 * 둘 다 없으면 null → 호출자가 /workspace-setup으로 보낸다.
 */
export async function loadShellContext(userId: string) {
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { ownerId: userId }, select: { id: true, name: true } }),
    prisma.spaceMember.findFirst({
      where: { userId },
      select: {
        spaceId: true,
        role: true,
        space: {
          select: {
            name: true,
            deckInstances: {
              where: { isActive: true },
              include: { deckApp: { select: { id: true, name: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    }),
  ])
  if (!workspace && !membership) return null
  return {
    workspaceName: workspace?.name ?? membership!.space.name,
    isOwner: membership?.role === 'OWNER',
    activeDecks: membership?.space.deckInstances.map(({ deckApp }) => deckApp) ?? [],
  }
}
