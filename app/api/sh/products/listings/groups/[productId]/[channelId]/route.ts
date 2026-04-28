import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productDisplayName } from '@/lib/sh/product-display'
import {
  applyChannelAllocation,
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { productChannelGroupMetaSchema } from '@/lib/sh/schemas'

/**
 * 판매채널 상품 "상품 × 채널" 그룹 뷰 API.
 *
 * 그룹 식별: listing의 items에 들어간 distinct productId가 1개인 경우만 그룹 대상.
 * 2개 이상(혼합 구성) listing은 그룹에 포함되지 않는다 — 기존 단일 listing 편집 폼에서 처리.
 */

type Params = { params: Promise<{ productId: string; channelId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { productId, channelId } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  // 상품·채널 소속 검증
  const [product, channel] = await Promise.all([
    prisma.invProduct.findFirst({
      where: { id: productId, spaceId: resolved.space.id },
      select: {
        id: true,
        name: true,
        internalName: true,
        msrp: true,
        optionAttributes: true,
        brand: { select: { id: true, name: true } },
      },
    }),
    prisma.channel.findFirst({
      where: { id: channelId, spaceId: resolved.space.id },
      select: {
        id: true,
        name: true,
        channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
      },
    }),
  ])
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  // 해당 productId 옵션이 들어간 listing 목록 (channel 제한)
  const candidateListings = await prisma.productListing.findMany({
    where: {
      spaceId: resolved.space.id,
      channelId,
      items: { some: { option: { productId } } },
    },
    orderBy: { createdAt: 'asc' },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
              retailPrice: true,
              productId: true,
              attributeValues: true,
            },
          },
        },
      },
    },
  })

  // 단일 product listing만 그룹에 포함
  const singleProductListings = candidateListings.filter((l) =>
    l.items.every((it) => it.option.productId === productId)
  )

  // 재고 배치
  const optionIds = Array.from(
    new Set(singleProductListings.flatMap((l) => l.items.map((it) => it.optionId)))
  )
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) stockMap.set(r.optionId, r._sum.quantity ?? 0)
  }

  const productMsrp = product.msrp != null ? Number(product.msrp) : null
  const listings = singleProductListings.map((l) => {
    const priceSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      retailPrice: it.option.retailPrice != null ? Number(it.option.retailPrice) : productMsrp,
    }))
    const stockSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      optionStock: stockMap.get(it.optionId) ?? 0,
    }))
    const baseline = computeListingRetailBaseline(priceSnapshots)
    const retailPrice = l.retailPrice != null ? Number(l.retailPrice) : null
    const autoAvailable = computeListingAvailableStock(stockSnapshots)
    const available = applyChannelAllocation(autoAvailable, l.channelAllocation)
    const effective = computeEffectiveStatus(l.status, available)
    const { diff, percent } = computeDiscount(baseline, retailPrice)
    return {
      id: l.id,
      searchName: l.searchName,
      displayName: l.displayName,
      internalCode: l.internalCode,
      memo: l.memo,
      status: l.status,
      effectiveStatus: effective,
      retailPrice,
      channelAllocation: l.channelAllocation,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      availableStock: available,
      autoAvailableStock: autoAvailable,
      items: l.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        sku: it.option.sku,
        quantity: it.quantity,
        attributeValues: (it.option.attributeValues ?? {}) as Record<string, string>,
      })),
      updatedAt: l.updatedAt.toISOString(),
    }
  })

  // 메타
  const meta = await prisma.productChannelGroupMeta.findUnique({
    where: { productId_channelId: { productId, channelId } },
    select: { keywords: true },
  })
  const keywords = Array.isArray(meta?.keywords) ? (meta!.keywords as string[]) : []

  const optionAttributes = Array.isArray(product.optionAttributes)
    ? (product.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
    : []

  return NextResponse.json({
    product: {
      id: product.id,
      name: product.name,
      internalName: product.internalName,
      displayName: productDisplayName(product),
      brand: product.brand,
      optionAttributes,
    },
    channel: { id: channel.id, name: channel.name, channelTypeDef: channel.channelTypeDef },
    meta: { keywords },
    listings,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { productId, channelId } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  // 소속 검증
  const [product, channel] = await Promise.all([
    prisma.invProduct.findFirst({
      where: { id: productId, spaceId: resolved.space.id },
      select: { id: true },
    }),
    prisma.channel.findFirst({
      where: { id: channelId, spaceId: resolved.space.id },
      select: { id: true },
    }),
  ])
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = productChannelGroupMetaSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }

  const saved = await prisma.productChannelGroupMeta.upsert({
    where: { productId_channelId: { productId, channelId } },
    create: {
      spaceId: resolved.space.id,
      productId,
      channelId,
      keywords: parsed.data.keywords,
    },
    update: { keywords: parsed.data.keywords },
    select: { keywords: true },
  })

  return NextResponse.json({ meta: { keywords: saved.keywords } })
}
