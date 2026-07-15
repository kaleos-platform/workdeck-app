import { prisma } from '@/lib/prisma'

/**
 * Slack 이벤트로부터 tool 실행에 쓸 "행위 사용자(User.id)"를 해석한다.
 *
 * ⚠️ 배경: 기존 MCP tool의 execute(ctx)는 ctx.userId만 받고, 내부에서 그 userId로
 * resolveMcpSpaceContext(=최고참 SpaceMember) / resolveMcpWorkspace(=Workspace.ownerId)로
 * Space·Workspace를 재해석한다. 따라서 Slack 발신자(event.user)를 그대로 넘길 수 없고,
 * "해당 Space의 OWNER 멤버(=Workspace 소유자)"의 User.id를 넘겨야 tool이 올바른
 * Space·Workspace로 귀결된다. (본 서비스는 User 1 : Workspace 1 : PERSONAL Space 1 모델)
 *
 * OWNER를 우선 선택하고, 없으면 최고참 멤버로 폴백한다. 멤버가 전혀 없으면 null.
 */
export async function resolveActingUserId(spaceId: string): Promise<string | null> {
  const owner = await prisma.spaceMember.findFirst({
    where: { spaceId, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  })
  if (owner) return owner.userId

  const fallback = await prisma.spaceMember.findFirst({
    where: { spaceId },
    orderBy: { createdAt: 'asc' },
    select: { userId: true },
  })
  return fallback?.userId ?? null
}
