// 쿠팡 로켓그로스 위치 ↔ 판매채널 1:1 페어링.
//
// 위치(InvStorageLocation)와 채널(Channel) 둘 다 externalSource='coupang_rocket_growth'
// 로 같은 외부 출처를 가리킨다(공간당 각 1개, @@unique 보장). 한쪽을 로켓으로 연동할 때
// 다른 쪽이 없으면 자동 생성해 양쪽을 보장한다 — 사용자가 어느 화면에서 시작하든 동일.

import { prisma } from '@/lib/prisma'
import { EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH } from '@/lib/inv/external-sources'

const ROCKET_CHANNEL_NAME = '쿠팡 로켓그로스'
const ROCKET_CHANNEL_TYPE_NAME = '판매채널'

/**
 * 로켓그로스 판매채널을 보장한다(없으면 생성). externalSource 로 1개만 유지.
 * - 이미 externalSource 채널이 있으면 그대로 반환.
 * - 없으면 같은 이름의 기존 채널이 있으면 그 채널에 externalSource 를 스탬프(승격),
 *   아니면 새로 생성. ChannelTypeDef(isSalesChannel) 는 없으면 보장.
 * @returns 채널 id, 새로 만들었는지 여부
 */
export async function ensureCoupangSalesChannel(
  spaceId: string
): Promise<{ channelId: string; created: boolean }> {
  const existing = await prisma.channel.findFirst({
    where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
    select: { id: true },
  })
  if (existing) return { channelId: existing.id, created: false }

  // isSalesChannel 타입 보장 (없으면 생성)
  const typeDef =
    (await prisma.channelTypeDef.findFirst({
      where: { spaceId, isSalesChannel: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    })) ??
    (await prisma.channelTypeDef.create({
      data: { spaceId, name: ROCKET_CHANNEL_TYPE_NAME, isSalesChannel: true },
      select: { id: true },
    }))

  // 같은 이름의 기존 채널이 있으면 externalSource 스탬프(승격), 없으면 생성.
  const byName = await prisma.channel.findFirst({
    where: { spaceId, name: ROCKET_CHANNEL_NAME },
    select: { id: true, externalSource: true },
  })
  if (byName) {
    if (!byName.externalSource) {
      await prisma.channel.update({
        where: { id: byName.id },
        data: { externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
      })
    }
    return { channelId: byName.id, created: false }
  }

  const created = await prisma.channel.create({
    data: {
      spaceId,
      name: ROCKET_CHANNEL_NAME,
      channelTypeDefId: typeDef.id,
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
    },
    select: { id: true },
  })
  return { channelId: created.id, created: true }
}

/**
 * 로켓그로스 보관 위치를 보장한다(없으면 생성). externalSource 로 1개만 유지.
 * workspaceId 가 주어지면 externalIntegrationKey 에 backfill(cron 워크스페이스 해석용).
 */
export async function ensureCoupangLocation(
  spaceId: string,
  workspaceId?: string
): Promise<{ locationId: string; created: boolean }> {
  const existing = await prisma.invStorageLocation.findFirst({
    where: { spaceId, externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH },
    select: { id: true, externalIntegrationKey: true },
  })
  if (existing) {
    if (workspaceId && !existing.externalIntegrationKey) {
      await prisma.invStorageLocation.update({
        where: { id: existing.id },
        data: { externalIntegrationKey: workspaceId },
      })
    }
    return { locationId: existing.id, created: false }
  }

  const created = await prisma.invStorageLocation.create({
    data: {
      spaceId,
      name: ROCKET_CHANNEL_NAME,
      type: 'OWN',
      externalSource: EXTERNAL_SOURCE_COUPANG_ROCKET_GROWTH,
      externalIntegrationKey: workspaceId ?? null,
    },
    select: { id: true },
  })
  return { locationId: created.id, created: true }
}

/**
 * 위치·채널 양쪽을 보장(1:1 페어링). 어느 쪽에서 연동을 시작하든 호출.
 * @param workspaceId 위치 externalIntegrationKey backfill 용 (cron 해석)
 */
export async function ensureCoupangChannelLocationPair(
  spaceId: string,
  workspaceId?: string
): Promise<{ channelId: string; locationId: string }> {
  const [channel, location] = await Promise.all([
    ensureCoupangSalesChannel(spaceId),
    ensureCoupangLocation(spaceId, workspaceId),
  ])
  return { channelId: channel.channelId, locationId: location.locationId }
}
