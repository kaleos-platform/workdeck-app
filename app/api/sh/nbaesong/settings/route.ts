import { NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { nbaesongExternalSource } from '@/lib/inv/external-sources'
import { NAVER_COMMERCE_PROVIDER, type NaverCommerceConfig } from '@/lib/naver-commerce/client'

/** GET — 스마트스토어 N배송 연동 설정(비밀값 제외). 설정 화면 표시용. */
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id
  const cred = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: NAVER_COMMERCE_PROVIDER } },
    select: { config: true, lastError: true },
  })
  const config = (cred?.config ?? null) as NaverCommerceConfig | null
  const stores = config?.stores ?? []

  const channels = stores.length
    ? await prisma.channel.findMany({
        where: {
          spaceId,
          externalSource: { in: stores.map((s) => nbaesongExternalSource(s.key)) },
        },
        select: { id: true, externalSource: true },
      })
    : []
  const channelByKey = new Map(channels.map((c) => [c.externalSource, c.id]))

  return NextResponse.json(
    {
      configured: !!cred,
      locationId: config?.locationId ?? null,
      stores: stores.map((s) => ({
        key: s.key,
        label: s.label,
        startDate: s.startDate,
        representativeChannelId: s.representativeChannelId,
        backfilledThrough: s.backfilledThrough,
        channelId: channelByKey.get(nbaesongExternalSource(s.key)) ?? null,
      })),
      lastError: cred?.lastError ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
