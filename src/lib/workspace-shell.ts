import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import type { Role } from '@/lib/auth/roles'

/**
 * workdeck 셸(사이드바) 공용 로딩 — settings·my-deck·approvals layout.
 * Workspace 소유 또는 Space 구성원이면 셸을 만든다(초대로 합류한 구성원은 Workspace가 없다).
 * 둘 다 없으면 null → 호출자가 /workspace-setup으로 보낸다. 같은 요청의 layout·page가 공유한다(cache).
 */
export const loadShellContext = cache(async function loadShellContext(userId: string) {
  const [workspace, membership] = await Promise.all([
    prisma.workspace.findUnique({ where: { ownerId: userId }, select: { id: true, name: true } }),
    resolveCurrentMembership(userId),
  ])
  const current = membership && !('forbidden' in membership) ? membership : null
  if (!workspace && !current) return null
  const activeDecks = current
    ? (
        await prisma.deckInstance.findMany({
          where: { spaceId: current.space.id, isActive: true },
          include: { deckApp: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        })
      ).map(({ deckApp }) => deckApp)
    : []
  return {
    workspaceName: current?.space.name ?? workspace!.name,
    // 멤버십 없이 Workspace만 있는 레거시 계정은 소유자다(role·isOwner 같은 판정).
    isOwner: (current?.role ?? 'OWNER') === 'OWNER',
    role: (current?.role ?? 'OWNER') as Role,
    spaceId: current?.space.id ?? null,
    activeDecks,
  }
})

/** Workspace 없이도 Space 구성원이면 true — 초대로 합류한 사용자를 /workspace-setup에 보내지 않기 위한 판정. */
export async function hasSpaceAccess(userId: string) {
  const member = await prisma.spaceMember.findFirst({ where: { userId }, select: { id: true } })
  return member !== null
}
