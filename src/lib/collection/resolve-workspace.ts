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
import { errorResponse, resolveSpaceContext, type SpaceMemberRole } from '@/lib/api-helpers'
import { resolveSpaceCoupangWorkspaceId } from '@/lib/inv/resolve-coupang-workspace'
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

  // Space → 쿠팡 워크스페이스 해석은 resolveWorkspace 와 같은 함수(엄격 키 → Space 연결 → 다른 Space 에
  // 묶이지 않은 본인 소유). Workspace.ownerId 만 보면 다른 멤버가 저장할 때 쿠팡 데이터가 없는 자기
  // 워크스페이스에 조용히 저장된다 — cron 이 보는 축과 일치해야 한다.
  const workspaceId = await resolveSpaceCoupangWorkspaceId(spaceCtx.space.id, spaceCtx.user.id)
  if (workspaceId) return { kind: 'session', workspaceId, role: spaceCtx.role }

  return {
    error: errorResponse(
      '이 계정에 연결된 쿠팡 워크스페이스를 찾지 못했습니다. ' +
        '쿠팡 계정 연동(로그인 자격)을 먼저 완료했는지, 그리고 쿠팡 데이터가 있는 공간으로 로그인했는지 확인해 주세요.',
      409
    ),
  }
}
