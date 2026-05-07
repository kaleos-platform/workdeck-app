import { NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/sh/products/listings/migrate-orphans
 *
 * channelProductId=null 인 고아 ProductListing들을 (spaceId, channelId, productId) 조합으로
 * 그룹화해서 각 그룹에 ChannelProduct를 생성하고 channelProductId를 연결한다.
 *
 * productId는 listing.items[0].option.productId 에서 추적한다.
 * items가 여러 product에 걸쳐 있으면 (혼합) 가장 많이 등장하는 productId를 사용한다.
 */
export async function POST() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  // 고아 listings + items + option.productId
  const orphans = await prisma.productListing.findMany({
    where: { spaceId, channelProductId: null },
    select: {
      id: true,
      channelId: true,
      searchName: true,
      displayName: true,
      managementName: true,
      keywords: true,
      memo: true,
      items: {
        select: {
          option: { select: { productId: true } },
        },
      },
    },
  })

  if (orphans.length === 0) {
    return NextResponse.json({ migrated: 0, groups: 0 })
  }

  // listing별 대표 productId 결정
  type Orphan = (typeof orphans)[number]
  function resolveProductId(listing: Orphan): string | null {
    const counts = new Map<string, number>()
    for (const item of listing.items) {
      const pid = item.option.productId
      counts.set(pid, (counts.get(pid) ?? 0) + 1)
    }
    if (counts.size === 0) return null
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  // (channelId, productId) 별로 그룹화
  const groupMap = new Map<string, { channelId: string; productId: string; listings: Orphan[] }>()
  for (const listing of orphans) {
    const productId = resolveProductId(listing)
    if (!productId) continue
    const key = `${listing.channelId}::${productId}`
    if (!groupMap.has(key)) {
      groupMap.set(key, { channelId: listing.channelId, productId, listings: [] })
    }
    groupMap.get(key)!.listings.push(listing)
  }

  let totalMigrated = 0

  await prisma.$transaction(async (tx) => {
    for (const { channelId, productId, listings } of groupMap.values()) {
      // 대표 baseSearchName: 첫 번째 listing의 searchName
      const baseSearchName = listings[0].searchName

      // keywords: 첫 번째 listing에서 가져옴
      const keywords = Array.isArray(listings[0].keywords) ? (listings[0].keywords as string[]) : []

      const cp = await tx.channelProduct.create({
        data: {
          spaceId,
          channelId,
          productId,
          baseSearchName,
          keywords,
        },
      })

      await tx.productListing.updateMany({
        where: { id: { in: listings.map((l) => l.id) } },
        data: { channelProductId: cp.id },
      })

      totalMigrated += listings.length
    }
  })

  return NextResponse.json({ migrated: totalMigrated, groups: groupMap.size })
}
