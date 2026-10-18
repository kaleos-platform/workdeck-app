import { cache } from 'react'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { measureCoupangAds } from '@/lib/coupang-ads/server-timing'
import { assertDeckWritable } from '@/lib/billing/entitlement'
import { authenticateWorker, resolveWorkerWorkspaceId } from '@/lib/worker-auth'
import { resolveSpaceCoupangWorkspaceId } from '@/lib/inv/resolve-coupang-workspace'

// 에러 응답 생성 헬퍼 — extra 필드를 병합해 추가 정보를 포함할 수 있음
export function errorResponse(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ message, ...extra }, { status })
}

/**
 * deck 컨텍스트 해석 옵션.
 *
 * `write: true` 는 **변경(POST/PUT/PATCH/DELETE) 핸들러 전용**이다. 구독이 만료된
 * Space 의 쓰기를 402 로 막되 조회는 그대로 통과시킨다. `resolveDeckContext` 는
 * 요청 객체를 받지 않아 HTTP 메서드를 알 수 없으므로, GET 과 mutation 이 같은 파일에
 * 공존하는 라우트에서도 호출부가 명시적으로 구분해 넘겨야 한다.
 */
export interface DeckContextOptions {
  write?: boolean
}

// 인증 + 워크스페이스 소유권 검증 (세션 또는 worker key)
export async function resolveWorkspace(opts?: DeckContextOptions) {
  // 워커 요청(x-worker-api-key 헤더 존재) — 세션으로 폴백하지 않는다. 키가 틀리면 401.
  const h = await headers()
  if (h.get('x-worker-api-key')) {
    const auth = await authenticateWorker(h)
    if ('error' in auth) return { error: auth.error }
    const ws = await resolveWorkerWorkspaceId(auth.scope, h.get('x-workspace-id'))
    if ('error' in ws) return { error: ws.error }
    return { workspace: { id: ws.workspaceId } }
  }

  const deckContext = await resolveDeckContext('coupang-ads', opts)
  const deckError = 'error' in deckContext ? deckContext.error : null
  if (deckError && deckError.status !== 404) {
    return { error: deckError }
  }

  const user = 'error' in deckContext ? await getUser() : deckContext.user
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  // Space 구성원은 그 Space 의 워크스페이스(resolveSpaceCoupangWorkspaceId — resolveCollectionAuth 와 같은
  // 해석기). ownerId 만 보면 초대받은 구성원은 쿠팡 데이터를 못 본다. 멤버십이 없으면 기존처럼 본인 소유.
  // ponytail: Space 는 최고참 멤버십(resolveSpaceContext) — 다중 Space 선택은 앱 전체 과제.
  const spaceId = 'error' in deckContext ? null : deckContext.space.id
  const workspace = await measureCoupangAds('auth_workspace', async () => {
    if (spaceId) {
      const id = await resolveSpaceCoupangWorkspaceId(spaceId, user.id)
      return id ? { id } : null
    }
    return prisma.workspace.findUnique({ where: { ownerId: user.id }, select: { id: true } })
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
export const resolveSpaceContext = cache(async function resolveSpaceContext() {
  const user = await measureCoupangAds('auth_user', getUser)
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const membership = await measureCoupangAds('auth_membership', () =>
    prisma.spaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' }, // 결정적 최고참 멤버십
      include: { space: { select: { id: true, name: true } } },
    })
  )
  if (!membership) return { error: errorResponse('공간이 없습니다', 404) }

  return {
    user,
    space: membership.space,
    role: membership.role as SpaceMemberRole,
  }
})

/**
 * 인증 + 명시적 Space 선택 + 멤버십 검증(웹 세션용). Task 4의 MCP Space 결정 규칙과 같다.
 * - requestedSpaceId가 있으면 그 Space의 구성원이어야 한다(아니면 403 — Space 존재 여부는 드러내지 않는다).
 * - 없으면 멤버십이 1개일 때만 그 Space. 2개 이상이면 400 SPACE_REQUIRED + 선택지 —
 *   최고참 멤버십으로 조용히 떨어지지 않는다(두 Space ADMIN이 다른 Space에 쓰는 사고 방지).
 */
export async function resolveRequestedSpaceContext(requestedSpaceId: string | null): Promise<
  | {
      user: NonNullable<Awaited<ReturnType<typeof getUser>>>
      space: { id: string; name: string }
      role: SpaceMemberRole
    }
  | { error: NextResponse }
> {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }

  const memberships = await prisma.spaceMember.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, space: { select: { id: true, name: true } } },
  })
  if (memberships.length === 0) return { error: errorResponse('공간이 없습니다', 404) }

  if (requestedSpaceId) {
    const m = memberships.find((x) => x.space.id === requestedSpaceId)
    if (!m) return { error: errorResponse('이 Space의 구성원이 아닙니다', 403) }
    return { user, space: m.space, role: m.role as SpaceMemberRole }
  }
  if (memberships.length === 1) {
    return { user, space: memberships[0].space, role: memberships[0].role as SpaceMemberRole }
  }
  return {
    error: errorResponse('여러 Space에 속해 있습니다. Space를 선택하세요', 400, {
      code: 'SPACE_REQUIRED',
      spaces: memberships.map((m) => ({ id: m.space.id, name: m.space.name, role: m.role })),
    }),
  }
}

const DECK_WRITE_MIN_ROLE: Partial<Record<string, SpaceMemberRole>> = {
  'coupang-ads': 'ADMIN',
  finance: 'ADMIN',
}

// 인증 + Space 멤버십 + DeckInstance 활성화 여부 검증
export async function resolveDeckContext(deckKey = 'coupang-ads', opts?: DeckContextOptions) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved

  const deckInstance = await measureCoupangAds('auth_deck', () =>
    prisma.deckInstance.findUnique({
      where: { spaceId_deckAppId: { spaceId: resolved.space.id, deckAppId: deckKey } },
    })
  )
  if (!deckInstance?.isActive) return { error: errorResponse('카드가 활성화되지 않았습니다', 403) }

  // Deck 별 쓰기 최소 역할(에디 결정 2026-10-18) — 돈·계좌가 걸린 Deck 만 ADMIN, 나머지는 구성원 누구나.
  const minRole = DECK_WRITE_MIN_ROLE[deckKey]
  if (opts?.write && minRole) {
    const denied = assertRole(resolved.role, minRole)
    if (denied) return { error: denied }
  }

  // 구독 만료 Space 의 쓰기 차단 — 조회(write 미지정)는 그대로 통과한다.
  if (opts?.write) {
    const blocked = await assertDeckWritable(resolved.space.id, deckKey)
    if (blocked) return { error: errorResponse(blocked, 402) }
  }

  return resolved
}

// 여러 Deck 중 하나라도 활성인 경우 통과 (공용 채널 API 등에서 사용)
export async function resolveAnyDeckContext(deckKeys: string[]) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved

  const activeInstances = await prisma.deckInstance.findMany({
    where: {
      spaceId: resolved.space.id,
      deckAppId: { in: deckKeys },
      isActive: true,
    },
    select: { deckAppId: true },
  })
  if (activeInstances.length === 0) {
    return { error: errorResponse('관련 카드가 활성화되지 않았습니다', 403) }
  }
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
