// 쿠팡 Workspace ↔ seller-hub Space 연결 해석.
//
// Workspace 와 Space 사이에는 직접 FK 가 없다. 수동 흐름은 로그인 유저
// (Workspace.ownerId)로 워크스페이스를 앵커하지만, cron 은 로그인 유저가 없다.
// 한 Space 에 멤버가 여러 명이면 각자 쿠팡 Workspace 를 소유할 수 있어 멤버
// 스캔은 모호하다. → 로켓그로스 위치(InvStorageLocation, externalSource=
// 'coupang_rocket_growth')의 externalIntegrationKey 에 페어링된 workspaceId 를
// 저장해 결정적으로 해석한다. 키는 수동 연동 시 1회 backfill 된다.

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

export type ResolvedCoupangWorkspace = {
  workspaceId: string
  locationId: string
}

/**
 * Space 의 로켓그로스 위치에 저장된 externalIntegrationKey(=workspaceId)로
 * 쿠팡 Workspace 를 해석한다. 위치가 없거나 키가 비어 있으면 null(연동 미설정).
 */
export async function resolveCoupangWorkspaceForSpace(
  spaceId: string
): Promise<ResolvedCoupangWorkspace | null> {
  const location = await prisma.invStorageLocation.findFirst({
    where: {
      spaceId,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
    },
    select: { id: true, externalIntegrationKey: true },
  })

  if (!location?.externalIntegrationKey) return null

  // 저장된 workspaceId 가 실재하는지 검증 (삭제된 워크스페이스 방어)
  const workspace = await prisma.workspace.findUnique({
    where: { id: location.externalIntegrationKey },
    select: { id: true },
  })
  if (!workspace) return null

  return { workspaceId: workspace.id, locationId: location.id }
}

/**
 * 인증 경계(워커 토큰)용 엄격 해석. cron 경로(resolveCoupangWorkspaceForSpace)는 그대로 둔다.
 * 모호하면 null(fail closed) — Space 안에 서로 다른 키가 둘 이상이거나,
 * 같은 키를 다른 Space 의 활성 로켓그로스 위치도 쓰면 어느 쪽 데이터인지 결정할 수 없다.
 */
export async function resolveCoupangWorkspaceForSpaceStrict(
  spaceId: string
): Promise<ResolvedCoupangWorkspace | null> {
  const locations = await prisma.invStorageLocation.findMany({
    where: {
      spaceId,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      externalIntegrationKey: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, externalIntegrationKey: true },
  })
  const keys = new Set(locations.map((l) => l.externalIntegrationKey))
  if (keys.size !== 1) return null
  const [location] = locations
  const workspaceId = location.externalIntegrationKey as string

  const shared = await prisma.invStorageLocation.findMany({
    where: {
      spaceId: { not: spaceId },
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      externalIntegrationKey: workspaceId,
    },
    select: { id: true },
    take: 1,
  })
  if (shared.length > 0) return null

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  })
  if (!workspace) return null

  return { workspaceId: workspace.id, locationId: location.id }
}

/**
 * 세션(사람) 요청용 Space → 쿠팡 워크스페이스 해석. resolveWorkspace·resolveCollectionAuth 가 공유한다.
 * 1) 로켓그로스 위치 키(엄격) 2) 키가 있는데 모호하면 null(fail closed — 본인 소유로 새지 않는다)
 * 3) Space 에 연결된 워크스페이스 4) 본인 소유 — 다른 Space 에 연결되지 않은 것만.
 */
export async function resolveSpaceCoupangWorkspaceId(
  spaceId: string,
  userId: string
): Promise<string | null> {
  const strict = await resolveCoupangWorkspaceForSpaceStrict(spaceId)
  if (strict) return strict.workspaceId
  const keyed = await prisma.invStorageLocation.count({
    where: {
      spaceId,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      isActive: true,
      externalIntegrationKey: { not: null },
    },
  })
  if (keyed > 0) return null

  const linked = await prisma.workspace.findUnique({ where: { spaceId }, select: { id: true } })
  if (linked) return linked.id

  const own = await prisma.workspace.findFirst({
    where: { ownerId: userId, OR: [{ spaceId: null }, { spaceId }] },
    select: { id: true },
  })
  return own?.id ?? null
}
