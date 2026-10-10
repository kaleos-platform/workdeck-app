/**
 * `api-credentials` · `source-setting` 라우트가 공유하는 워크스페이스 해석.
 *
 * 스코프 축이 어긋나 있다: `/settings/integrations`는 Space 스코프 허브(옆의 Slack 카드는
 * SlackInstallation/SpaceSlackChannel = Space)인데, 쿠팡 수집 설정은 전부 레거시 Workspace
 * 스코프(ownerId @unique, 사용자 1:1)다.
 *
 * 두 축을 잇는 정답은 `InvStorageLocation.externalIntegrationKey` 다 —
 * cron(`resolveCoupangWorkspaceForSpace`)이 쓰는 바로 그 축이고, 쿠팡 재고·크롤링 자격이
 * 실제로 사는 워크스페이스를 가리킨다. **여기서도 반드시 같은 축을 쓴다.**
 *
 * Workspace.ownerId 로 잡으면 안 된다: 운영에서는 쿠팡 데이터가 한 워크스페이스에 몰려
 * 있고 그 소유자는 계정 하나뿐이라, 다른 멤버가 로그인해 저장하면 "자기 소유 워크스페이스"
 * (쿠팡 데이터가 없는 곳)에 조용히 저장된다. UI 는 성공으로 보이는데 워커는 그 워크스페이스를
 * 보지 않아 연결 테스트와 수집이 계속 실패한다.
 *
 * `resolveDeckContext('coupang-ads')`는 DeckInstance.isActive 를 요구해 이 두 라우트에는
 * 맞지 않는다(예: seller-ops 설정 페이지에서 coupang-ads Deck 이 아직 활성화되지 않은 채로
 * API 자격을 먼저 등록하는 경우가 정상 흐름이다). 대신 `resolveSpaceContext()`로 Space
 * 멤버십 + role 만 확인한다.
 *
 * `ensureWorkspaceForUser`로 자동 생성하지 않는다 — 유령 워크스페이스가 생기면 UI 는
 * "등록됨"인데 워커는 영원히 못 보는 무음 실패가 된다. 해석 실패는 409 로 명시한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { errorResponse, resolveSpaceContext, type SpaceMemberRole } from '@/lib/api-helpers'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { authenticateWorker, resolveWorkerWorkspaceId } from '@/lib/worker-auth'

export type CollectionAuthContext =
  | { kind: 'worker'; workspaceId: string }
  | { kind: 'session'; workspaceId: string; role: SpaceMemberRole }

export async function resolveCollectionAuth(
  request: NextRequest
): Promise<{ error: NextResponse } | CollectionAuthContext> {
  if (request.headers.get('x-worker-api-key')) {
    const auth = await authenticateWorker(request.headers)
    if ('error' in auth) return { error: auth.error }
    const ws = await resolveWorkerWorkspaceId(auth.scope, request.headers.get('x-workspace-id'))
    if ('error' in ws) return { error: ws.error }
    return { kind: 'worker', workspaceId: ws.workspaceId }
  }

  const spaceCtx = await resolveSpaceContext()
  // 'error' in spaceCtx 만으로는 판별 유니온이 좁혀지지 않는다(다른 분기의 error가
  // `?: undefined`로 타입에 남아있어). truthy 체크까지 함께 해야 한다.
  if ('error' in spaceCtx && spaceCtx.error) return { error: spaceCtx.error }

  // 1순위: 현재 Space 에 연결된 쿠팡 워크스페이스.
  //
  // Workspace.ownerId 축으로 잡으면 안 된다. 운영 데이터에서 쿠팡 재고·크롤링 자격은
  // 모두 한 워크스페이스에 있는데 그 소유자는 특정 계정 하나뿐이라, 다른 멤버가 로그인해
  // 저장하면 "자기 소유 워크스페이스"(쿠팡 데이터가 없는 곳)에 조용히 저장된다. UI 는
  // 저장 성공으로 보이지만 워커는 그 워크스페이스를 보지 않아 연결 테스트·수집이 계속
  // 실패한다. cron(resolveCoupangWorkspaceForSpace) 이 쓰는 축과 반드시 일치해야 한다.
  const coupang = await resolveCoupangWorkspaceForSpace(spaceCtx.space.id)
  if (coupang) {
    return { kind: 'session', workspaceId: coupang.workspaceId, role: spaceCtx.role }
  }

  // 2순위: 쿠팡 연동 위치가 아직 없는 신규 Space — 본인 소유 워크스페이스로 폴백한다.
  const owned = await prisma.workspace.findUnique({
    where: { ownerId: spaceCtx.user.id },
    select: { id: true },
  })
  if (owned) {
    return { kind: 'session', workspaceId: owned.id, role: spaceCtx.role }
  }

  return {
    error: errorResponse(
      '이 계정에 연결된 쿠팡 워크스페이스를 찾지 못했습니다. ' +
        '쿠팡 계정 연동(로그인 자격)을 먼저 완료했는지, 그리고 쿠팡 데이터가 있는 공간으로 로그인했는지 확인해 주세요.',
      409
    ),
  }
}
