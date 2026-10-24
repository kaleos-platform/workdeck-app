// 스마트스토어 N배송 판매채널 보장. 스토어별 externalSource 1개(`naver_nbaesong:{storeKey}`).
// ensureCoupangSalesChannel 과 같은 순서: externalSource → 같은 이름 승격 → 생성.

import { prisma } from '@/lib/prisma'
import { nbaesongExternalSource } from '@/lib/inv/external-sources'

export async function ensureNbaesongChannel(p: {
  spaceId: string
  storeKey: string
  label: string
  representativeChannelId: string | null
}): Promise<string> {
  const { spaceId, storeKey, label, representativeChannelId } = p
  const externalSource = nbaesongExternalSource(storeKey)
  const name = `${label} N배송`

  const bySource = await prisma.channel.findFirst({
    where: { spaceId, externalSource },
    select: { id: true },
  })
  let id = bySource?.id
  if (!id) {
    const byName = await prisma.channel.findFirst({
      where: { spaceId, name },
      select: { id: true },
    })
    if (byName) {
      id = byName.id
      await prisma.channel.update({ where: { id }, data: { externalSource } })
    }
  }
  if (!id) {
    const typeDef =
      (await prisma.channelTypeDef.findFirst({
        where: { spaceId, isSalesChannel: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      })) ??
      (await prisma.channelTypeDef.create({
        data: { spaceId, name: '판매채널', isSalesChannel: true },
        select: { id: true },
      }))
    const created = await prisma.channel.create({
      data: { spaceId, name, channelTypeDefId: typeDef.id, externalSource },
      select: { id: true },
    })
    id = created.id
  }
  await prisma.channel.update({ where: { id }, data: { representativeChannelId } })
  return id
}
