import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ productId: string; channelId: string }> }

const SALES_CHANNEL_ONLY_MESSAGE = '판매채널 상품은 판매채널 유형의 채널에만 등록할 수 있습니다'

const COPY_SUFFIX_RE = / \(복사( \d+)?\)$/

function stripCopySuffix(name: string): string {
  return name.replace(COPY_SUFFIX_RE, '')
}

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId, channelId: sourceChannelId } = await params

  const body = await req.json().catch(() => ({}))
  const targetChannelId = typeof body.targetChannelId === 'string' ? body.targetChannelId : null
  if (!targetChannelId) return errorResponse('targetChannelId가 필요합니다', 400)

  const [product, sourceChannel, targetChannel] = await Promise.all([
    prisma.invProduct.findFirst({
      where: { id: productId, spaceId: resolved.space.id },
      select: { id: true },
    }),
    prisma.channel.findFirst({
      where: { id: sourceChannelId, spaceId: resolved.space.id },
      select: { id: true, channelTypeDef: { select: { isSalesChannel: true } } },
    }),
    prisma.channel.findFirst({
      where: { id: targetChannelId, spaceId: resolved.space.id },
      select: { id: true, channelTypeDef: { select: { isSalesChannel: true } } },
    }),
  ])
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
  if (!sourceChannel) return errorResponse('원본 채널을 찾을 수 없습니다', 404)
  if (!targetChannel) return errorResponse('대상 채널을 찾을 수 없습니다', 404)
  if (sourceChannel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse(SALES_CHANNEL_ONLY_MESSAGE, 400)
  }
  if (targetChannel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse(SALES_CHANNEL_ONLY_MESSAGE, 400)
  }

  const sourceListings = await prisma.productListing.findMany({
    where: {
      spaceId: resolved.space.id,
      channelId: sourceChannelId,
      items: { some: { option: { productId } } },
    },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  })
  // 단일 product 그룹만 복제 대상
  const optionIdToProductId = new Map<string, string>()
  const allOptionIds = Array.from(
    new Set(sourceListings.flatMap((l) => l.items.map((it) => it.optionId)))
  )
  if (allOptionIds.length > 0) {
    const options = await prisma.invProductOption.findMany({
      where: { id: { in: allOptionIds } },
      select: { id: true, productId: true },
    })
    for (const o of options) optionIdToProductId.set(o.id, o.productId)
  }
  const groupListings = sourceListings.filter((l) =>
    l.items.every((it) => optionIdToProductId.get(it.optionId) === productId)
  )
  if (groupListings.length === 0) {
    return errorResponse('복제할 listing이 없습니다', 404)
  }

  // 옵션이 ACTIVE 상품에 속해있는지 검증 (target과 무관, 옵션은 product 단위)
  const activeOptions = await prisma.invProductOption.findMany({
    where: {
      id: { in: allOptionIds },
      product: { spaceId: resolved.space.id, status: 'ACTIVE' },
    },
    select: { id: true },
  })
  if (activeOptions.length !== allOptionIds.length) {
    return errorResponse('일부 옵션이 미사용 상품에 속해 있어 복제할 수 없습니다', 400)
  }

  // 그룹 메타(키워드) 조회
  const sourceMeta = await prisma.productChannelGroupMeta.findUnique({
    where: { productId_channelId: { productId, channelId: sourceChannelId } },
    select: { keywords: true },
  })

  await prisma.$transaction(async (tx) => {
    // @@unique([channelId, searchName]) 회피 — listing 단위로 (복사 N) suffix 부여
    // 같은 candidate를 재사용해 그룹 일관성 유지
    const usedNames = new Set<string>()
    for (const src of groupListings) {
      const baseName = stripCopySuffix(src.searchName)
      let suffix = ' (복사)'
      let candidate = `${baseName}${suffix}`
      for (let i = 2; i < 200; i++) {
        const exists =
          usedNames.has(candidate) ||
          (await tx.productListing.findFirst({
            where: { channelId: targetChannelId, searchName: candidate },
            select: { id: true },
          }))
        if (!exists) break
        suffix = ` (복사 ${i})`
        candidate = `${baseName}${suffix}`
      }
      usedNames.add(candidate)

      const newDisplayName = src.displayName === src.searchName ? candidate : src.displayName
      const newManagementName = src.managementName
        ? `${stripCopySuffix(src.managementName)}${suffix}`
        : null
      const newInternalCode = src.internalCode
        ? `${stripCopySuffix(src.internalCode)}${suffix}`
        : null

      const created = await tx.productListing.create({
        data: {
          spaceId: resolved.space.id,
          channelId: targetChannelId,
          searchName: candidate,
          displayName: newDisplayName,
          managementName: newManagementName,
          internalCode: newInternalCode,
          keywords: src.keywords ?? [],
          retailPrice: src.retailPrice,
          channelAllocation: src.channelAllocation,
          status: src.status,
          memo: src.memo,
        },
      })
      if (src.items.length > 0) {
        await tx.productListingItem.createMany({
          data: src.items.map((it) => ({
            listingId: created.id,
            optionId: it.optionId,
            quantity: it.quantity,
            sortOrder: it.sortOrder,
          })),
        })
      }
    }

    // 그룹 메타(키워드) 복사 — target 그룹에 없을 때만 새로 생성
    if (sourceMeta && Array.isArray(sourceMeta.keywords) && sourceMeta.keywords.length > 0) {
      await tx.productChannelGroupMeta.upsert({
        where: { productId_channelId: { productId, channelId: targetChannelId } },
        create: {
          spaceId: resolved.space.id,
          productId,
          channelId: targetChannelId,
          keywords: sourceMeta.keywords,
        },
        update: {},
      })
    }
  })

  return NextResponse.json(
    { productId, channelId: targetChannelId, count: groupListings.length },
    { status: 201 }
  )
}
