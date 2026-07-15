import { prisma } from '@/lib/prisma'
import type { SpaceMemberRole } from '@/lib/api-helpers'

/**
 * MCP tool executor 전용 컨텍스트 리졸버.
 *
 * ⚠️ 중요: 이 파일의 함수는 절대 NextResponse나 errorResponse를 반환하지 않는다.
 * tool executor 내부에서 호출되므로 HTTP 응답 객체가 아니라 순수 데이터를
 * 반환하고, 실패는 한국어 메시지를 담은 Error를 throw해 신호한다.
 * (api-helpers.ts의 resolveSpaceContext/resolveDeckContext는 쿠키 세션 +
 *  errorResponse 기반이라 형태를 재사용하지 않고 userId 인자 버전으로 새로 작성)
 */

export interface McpSpaceContext {
  space: { id: string; name: string }
  role: SpaceMemberRole
}

/** 사용자의 최고참 Space 멤버십을 조회한다. 없으면 throw. */
export async function resolveMcpSpaceContext(userId: string): Promise<McpSpaceContext> {
  const membership = await prisma.spaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' }, // 결정적 최고참 멤버십
    include: { space: { select: { id: true, name: true } } },
  })
  if (!membership) throw new Error('공간이 없습니다')

  return {
    space: membership.space,
    role: membership.role as SpaceMemberRole,
  }
}

/**
 * Space 컨텍스트 + 지정 Deck 활성화 여부를 검증한다.
 * Deck 인스턴스가 없거나 비활성이면 throw.
 */
export async function resolveMcpDeckContext(
  userId: string,
  deckKey: string
): Promise<McpSpaceContext> {
  const ctx = await resolveMcpSpaceContext(userId)

  const deckInstance = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId: ctx.space.id, deckAppId: deckKey } },
    select: { isActive: true },
  })
  if (!deckInstance?.isActive) {
    throw new Error(`${deckKey} 카드가 활성화되지 않았습니다`)
  }

  return ctx
}

/**
 * coupang-ads용 — 웹 route의 resolveWorkspace()와 동일한 게이트 의미로 워크스페이스를 조회한다.
 *
 * 웹 resolveWorkspace()는 resolveDeckContext('coupang-ads')를 호출해서:
 *  - deck 비활성(403 계열, 404 아님)이면 거부하고,
 *  - Space 멤버십 없음(404)이면 관용하고 workspace.findUnique({ ownerId })로 폴백한다.
 *
 * 이 함수는 그 의미를 인라인으로 재현한다(resolveMcpDeckContext는 "Space 없음"과
 * "deck 비활성"을 둘 다 throw로 뭉개서 관용 케이스를 구분 못 하므로 재사용하지 않는다).
 *
 * 세 분기:
 *  1. Space 없음(레거시) → 관용, workspace 폴백으로 진행
 *  2. Space 있음 + deck 비활성 → throw(거부)
 *  3. Space 있음 + deck 활성 → workspace 폴백으로 진행
 */
export async function resolveMcpWorkspace(
  userId: string
): Promise<{ workspace: { id: string }; space: { id: string } | null }> {
  const membership = await prisma.spaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' }, // 결정적 최고참 멤버십
    include: { space: { select: { id: true } } },
  })

  // Space가 있으면 coupang-ads deck 활성 여부를 검증한다.
  // Space가 없으면(레거시) 검증을 건너뛰고 관용한다.
  if (membership) {
    const deckInstance = await prisma.deckInstance.findUnique({
      where: {
        spaceId_deckAppId: { spaceId: membership.space.id, deckAppId: 'coupang-ads' },
      },
      select: { isActive: true },
    })
    if (!deckInstance?.isActive) {
      throw new Error('쿠팡 광고 카드가 활성화되지 않았습니다')
    }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: userId },
    select: { id: true },
  })
  if (!workspace) throw new Error('워크스페이스가 없습니다')

  // space는 승인 큐 라우팅(AgentPendingAction.spaceId)에 필요하다. 레거시(Space 없음)면 null —
  // 조회(read) tool은 workspace만 쓰므로 무관하나, write tool은 space가 있어야 큐잉 가능하다.
  return { workspace, space: membership?.space ?? null }
}
