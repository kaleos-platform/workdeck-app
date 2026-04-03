import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'

// 에러 응답 생성 헬퍼 — extra 필드를 병합해 추가 정보를 포함할 수 있음
export function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...extra }, { status })
}

// 인증 + 워크스페이스 소유권 검증 (기존 — 점진 전환 기간 동안 유지)
export async function resolveWorkspace() {
  const deckContext = await resolveDeckContext('coupang-ads')
  const deckError = 'error' in deckContext ? deckContext.error : null
  if (deckError && deckError.status !== 404) {
    return { error: deckError }
  }

  const user = 'error' in deckContext ? await getUser() : deckContext.user
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
    select: { id: true },
  })
  if (!workspace) return { error: errorResponse('워크스페이스가 없습니다', 404) }

  if ('error' in deckContext) {
    return { user, workspace }
  }

  return {
    user,
    workspace,
    space: deckContext.space,
    role: deckContext.role,
  }
}

// ─── Workdeck OS 헬퍼 ────────────────────────────────────────────────────────

export type SpaceMemberRole = 'OWNER' | 'ADMIN' | 'MEMBER'

// 인증 + Space 멤버십 검증 (Deck 활성화 여부와 무관)
export async function resolveSpaceContext() {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id },
    include: { space: { select: { id: true, name: true } } },
  })
  if (!membership) return { error: errorResponse('공간이 없습니다', 404) }

  return {
    user,
    space: membership.space,
    role: membership.role as SpaceMemberRole,
  }
}

// 인증 + Space 멤버십 + DeckInstance 활성화 여부 검증
export async function resolveDeckContext(deckKey = 'coupang-ads') {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved

  const deckInstance = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId: resolved.space.id, deckAppId: deckKey } },
  })
  if (!deckInstance?.isActive) return { error: errorResponse('카드가 활성화되지 않았습니다', 403) }

  return resolved
}

// 역할 계층: OWNER > ADMIN > MEMBER
const ROLE_HIERARCHY: Record<SpaceMemberRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 }

// 요구 역할보다 낮으면 403 반환, 통과하면 null 반환
export function assertRole(userRole: SpaceMemberRole, required: SpaceMemberRole) {
  if (ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[required])
    return errorResponse('권한이 없습니다', 403)
  return null
}

// cross-space 통신 차단 — spaceId 불일치 시 403 반환
export function assertSameSpace(sourceSpaceId: string, targetSpaceId: string) {
  if (sourceSpaceId !== targetSpaceId)
    return errorResponse('cross-space 통신은 허용되지 않습니다', 403)
  return null
}

// ─── Worker 인증 ─────────────────────────────────────────────────────────────

// 워커 프로세스의 x-worker-api-key 헤더로 인증
export function resolveWorkerAuth(request: NextRequest) {
  const apiKey = request.headers.get('x-worker-api-key')
  const expected = process.env.WORKER_API_KEY
  if (!expected || !apiKey || apiKey !== expected) {
    return { error: errorResponse('워커 인증에 실패했습니다', 401) }
  }
  return { authenticated: true as const }
}
