// 쿠팡 Workspace → seller-hub Space 역방향 해석.
//
// resolveCoupangWorkspaceForSpace(src/lib/inv/resolve-coupang-workspace.ts)의 반대 방향.
// 같은 연결 축(InvStorageLocation.externalSource='coupang_rocket_growth' 의
// externalIntegrationKey=workspaceId)을 반대로 조회한다 — 다른 축(예: Workspace.ownerId)을
// 쓰면 cron 이 만드는 CoupangWriteJob.spaceId 가 실제 쿠팡 데이터가 있는 Space 와 어긋난다.

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'

/**
 * workspaceId 를 externalIntegrationKey 로 가진 로켓그로스 위치의 spaceId 를 찾는다.
 * 위치가 없으면 null(연동 미설정 — cron 이 잡을 만들지 않는다).
 */
export async function resolveSpaceIdForWorkspace(workspaceId: string): Promise<string | null> {
  const location = await prisma.invStorageLocation.findFirst({
    where: {
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      externalIntegrationKey: workspaceId,
      isActive: true,
    },
    select: { spaceId: true },
  })
  return location?.spaceId ?? null
}

/**
 * space → 쿠팡 workspace. 미연결이면 throw(승인 큐 액션 생성 시점 가드).
 * 승인 시점·워커 실행 시점이 아니라 액션 "생성" 시점에 실패시켜야
 * 사람이 실행 불가능한 액션을 승인하는 사고를 막는다.
 */
export async function requireCoupangWorkspaceId(spaceId: string): Promise<string> {
  const ws = await resolveCoupangWorkspaceForSpace(spaceId)
  if (!ws) throw new Error('쿠팡 워크스페이스가 연결되어 있지 않습니다')
  return ws.workspaceId
}
