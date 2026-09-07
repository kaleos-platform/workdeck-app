/**
 * `api-credentials` · `source-setting` 라우트가 공유하는 워크스페이스 해석.
 *
 * 스코프 축이 어긋나 있다: `/settings/integrations`는 Space 스코프 허브(옆의 Slack 카드는
 * SlackInstallation/SpaceSlackChannel = Space)인데, 쿠팡 수집 설정은 전부 레거시 Workspace
 * 스코프(ownerId @unique, 사용자 1:1)다.
 *
 * `resolveDeckContext('coupang-ads')`는 DeckInstance.isActive 를 요구해 이 두 라우트에는
 * 맞지 않는다(예: seller-ops 설정 페이지에서 coupang-ads Deck 이 아직 활성화되지 않은 채로
 * API 자격을 먼저 등록하는 경우가 정상 흐름이다). 대신 `resolveSpaceContext()`로 Space
 * 멤버십 + role 만 확인하고, Workspace는 **호출한 사용자 본인 소유(ownerId)**만 조회한다.
 *
 * `ensureWorkspaceForUser`로 자동 생성하지 않는다 — Space 소유자가 아닌 멤버가 저장을
 * 시도했을 때 그 사람의 유령 워크스페이스가 만들어지고, UI는 "등록됨"으로 보이는데
 * 워커는 영원히 못 보는 사고(무음 수집 실패)를 막기 위해서다. 활성 워크스페이스가
 * 없으면 409로 명시 실패한다.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, resolveSpaceContext, type SpaceMemberRole } from '@/lib/api-helpers'

export type CollectionAuthContext =
  | { kind: 'worker'; workspaceId: string }
  | { kind: 'session'; workspaceId: string; role: SpaceMemberRole }

function isWorkerRequest(request: NextRequest): boolean {
  const key = request.headers.get('x-worker-api-key')
  const expected = process.env.WORKER_API_KEY
  return !!(key && expected && key === expected)
}

export async function resolveCollectionAuth(
  request: NextRequest
): Promise<{ error: ReturnType<typeof errorResponse> } | CollectionAuthContext> {
  if (isWorkerRequest(request)) {
    // 워커 폴백 체인: x-workspace-id 헤더 → WORKER_DEFAULT_WORKSPACE_ID → findFirst.
    // resolveWorkspace()(src/lib/api-helpers.ts)의 워커 분기와 동일한 순서.
    const headerWorkspaceId = request.headers.get('x-workspace-id')
    if (headerWorkspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: headerWorkspaceId },
        select: { id: true },
      })
      if (workspace) return { kind: 'worker', workspaceId: workspace.id }
    }
    const defaultId = process.env.WORKER_DEFAULT_WORKSPACE_ID
    if (defaultId) {
      const workspace = await prisma.workspace.findUnique({
        where: { id: defaultId },
        select: { id: true },
      })
      if (workspace) return { kind: 'worker', workspaceId: workspace.id }
    }
    const workspace = await prisma.workspace.findFirst({ select: { id: true } })
    if (workspace) return { kind: 'worker', workspaceId: workspace.id }
    return { error: errorResponse('워크스페이스가 없습니다', 404) }
  }

  const spaceCtx = await resolveSpaceContext()
  // 'error' in spaceCtx 만으로는 판별 유니온이 좁혀지지 않는다(다른 분기의 error가
  // `?: undefined`로 타입에 남아있어). truthy 체크까지 함께 해야 한다.
  if ('error' in spaceCtx && spaceCtx.error) return { error: spaceCtx.error }

  const workspace = await prisma.workspace.findUnique({
    where: { ownerId: spaceCtx.user.id },
    select: { id: true },
  })
  if (!workspace) {
    return { error: errorResponse('쿠팡 계정 연동을 먼저 완료하세요', 409) }
  }

  return { kind: 'session', workspaceId: workspace.id, role: spaceCtx.role }
}
