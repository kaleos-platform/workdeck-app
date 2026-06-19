import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/sh/products/listings/mirror?channelId=<연동 채널 id>
 *
 * 채널 자체 배송(연동) 채널의 읽기전용 미러 뷰 데이터.
 * - 입력 채널의 representativeChannelId(대표 채널)의 판매채널 상품(listing)을 조회전용으로 반환.
 * - 입력 채널의 externalSource로 페어링된 InvStorageLocation을 찾아, 구성 옵션별
 *   (a) 연동 재고(해당 위치 InvStockLevel), (b) 옵션 매칭 상태(InvLocationProductMapItem)를 덧붙인다.
 *
 * 데이터 변경 없음(순수 조회). status로 안내 상태를 구분:
 *  - 'ok'                : 대표·위치 모두 연결됨
 *  - 'no_representative' : 대표 채널 미설정
 *  - 'not_fulfillment'   : 입력 채널이 연동 채널이 아님(externalSource=null)
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const channelId = req.nextUrl.searchParams.get('channelId')?.trim()
  if (!channelId) return errorResponse('channelId가 필요합니다', 400)

  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: {
      id: true,
      name: true,
      externalSource: true,
      representativeChannelId: true,
      representativeChannel: { select: { id: true, name: true } },
    },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  // 연동 채널이 아니면(통합재고 채널) 미러 대상 아님
  if (channel.externalSource == null) {
    return NextResponse.json({
      status: 'not_fulfillment',
      channel: { id: channel.id, name: channel.name },
    })
  }

  // 대표 채널 미설정
  if (!channel.representativeChannelId) {
    return NextResponse.json({
      status: 'no_representative',
      channel: { id: channel.id, name: channel.name },
    })
  }

  // 대표 채널의 listing(구성 옵션 포함) 조회
  const listings = await prisma.productListing.findMany({
    where: { channelId: channel.representativeChannelId, spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      searchName: true,
      displayName: true,
      managementName: true,
      internalCode: true,
      status: true,
      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          optionId: true,
          quantity: true,
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
              attributeValues: true,
              product: { select: { id: true, name: true, internalName: true } },
            },
          },
        },
      },
    },
  })

  // 페어링 위치(입력 채널 externalSource와 동일) — 읽기전용 조회
  const location = await prisma.invStorageLocation.findFirst({
    where: { spaceId: resolved.space.id, externalSource: channel.externalSource },
    select: { id: true, name: true },
  })

  // 구성 옵션 전체 수집
  const optionIds = Array.from(new Set(listings.flatMap((l) => l.items.map((it) => it.optionId))))

  // 위치별 재고 + 매칭 상태 배치 조회
  const stockMap = new Map<string, number>()
  const matchedSet = new Set<string>()
  if (location && optionIds.length > 0) {
    const [stocks, mapped] = await Promise.all([
      prisma.invStockLevel.findMany({
        where: { locationId: location.id, optionId: { in: optionIds } },
        select: { optionId: true, quantity: true },
      }),
      prisma.invLocationProductMapItem.findMany({
        where: { optionId: { in: optionIds }, map: { locationId: location.id } },
        select: { optionId: true },
      }),
    ])
    for (const s of stocks) stockMap.set(s.optionId, s.quantity)
    for (const m of mapped) matchedSet.add(m.optionId)
  }

  const mirroredListings = listings.map((l) => ({
    id: l.id,
    searchName: l.searchName,
    displayName: l.displayName,
    managementName: l.managementName,
    internalCode: l.internalCode,
    status: l.status,
    items: l.items.map((it) => ({
      optionId: it.optionId,
      optionName: it.option.name,
      sku: it.option.sku,
      quantity: it.quantity,
      attributeValues: (it.option.attributeValues ?? {}) as Record<string, string>,
      productName: it.option.product.internalName ?? it.option.product.name,
      // 연동 현황
      linkedStock: location ? (stockMap.get(it.optionId) ?? 0) : null, // 페어링 위치 재고 (위치 없으면 null)
      matched: matchedSet.has(it.optionId), // 옵션 매칭 여부
    })),
  }))

  return NextResponse.json({
    status: 'ok',
    channel: { id: channel.id, name: channel.name },
    representative: channel.representativeChannel,
    location: location ? { id: location.id, name: location.name } : null,
    listings: mirroredListings,
  })
}
