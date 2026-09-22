// 쿠팡 Workspace → seller-hub Space 역방향 해석.
//
// resolveCoupangWorkspaceForSpace(src/lib/inv/resolve-coupang-workspace.ts)의 반대 방향.
// 같은 연결 축(InvStorageLocation.externalSource='coupang_rocket_growth' 의
// externalIntegrationKey=workspaceId)을 반대로 조회한다 — 다른 축(예: Workspace.ownerId)을
// 쓰면 cron 이 만드는 CoupangWriteJob.spaceId 가 실제 쿠팡 데이터가 있는 Space 와 어긋난다.

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

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
