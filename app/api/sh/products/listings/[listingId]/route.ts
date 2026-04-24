import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productListingPatchSchema } from '@/lib/sh/schemas'
import {
  applyChannelAllocation,
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { productDisplayName } from '@/lib/sh/product-display'

type Params = { params: Promise<{ listingId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    include: {
      channel: { select: { id: true, name: true, kind: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          option: {
            select: {
              id: true,
              name: true,
              sku: true,
              retailPrice: true,
              costPrice: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  internalName: true,
                  msrp: true,
                  brand: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  const optionIds = listing.items.map((i) => i.optionId)
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) stockMap.set(r.optionId, r._sum.quantity ?? 0)
  }

  const priceSnapshots = listing.items.map((it) => ({
    quantity: it.quantity,
    retailPrice:
      it.option.retailPrice != null
        ? Number(it.option.retailPrice)
        : it.option.product?.msrp != null
          ? Number(it.option.product.msrp)
          : null,
  }))
  const stockSnapshots = listing.items.map((it) => ({
    quantity: it.quantity,
    optionStock: stockMap.get(it.optionId) ?? 0,
  }))
  const baseline = computeListingRetailBaseline(priceSnapshots)
  const retailPrice = listing.retailPrice != null ? Number(listing.retailPrice) : null
  const autoAvailable = computeListingAvailableStock(stockSnapshots)
  const available = applyChannelAllocation(autoAvailable, listing.channelAllocation)
  const effective = computeEffectiveStatus(listing.status, available)
  const { diff, percent } = computeDiscount(baseline, retailPrice)

  return NextResponse.json({
    listing: {
      id: listing.id,
      channel: listing.channel,
      internalCode: listing.internalCode,
      searchName: listing.searchName,
      displayName: listing.displayName,
      keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
      retailPrice,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      status: listing.status,
      effectiveStatus: effective,
      availableStock: available,
      autoAvailableStock: autoAvailable,
      channelAllocation: listing.channelAllocation,
      memo: listing.memo,
      items: listing.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        sku: it.option.sku,
        productId: it.option.product.id,
        productName: productDisplayName(it.option.product),
        productOfficialName: it.option.product.name,
        brandName: it.option.product.brand?.name ?? null,
        retailPrice:
          it.option.retailPrice != null
            ? Number(it.option.retailPrice)
            : it.option.product?.msrp != null
              ? Number(it.option.product.msrp)
              : null,
        costPrice: it.option.costPrice != null ? Number(it.option.costPrice) : null,
        quantity: it.quantity,
        sortOrder: it.sortOrder,
        optionStock: stockMap.get(it.optionId) ?? 0,
      })),
      createdAt: listing.createdAt.toISOString(),
      updatedAt: listing.updatedAt.toISOString(),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const existing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    select: { id: true, channelId: true, searchName: true },
  })
  if (!existing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = productListingPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // searchName 변경 시 같은 채널 내 중복 검증
  if (input.searchName && input.searchName !== existing.searchName) {
    const dup = await prisma.productListing.findFirst({
      where: {
        channelId: existing.channelId,
        searchName: input.searchName,
        NOT: { id: listingId },
      },
      select: { id: true },
    })
    if (dup) return errorResponse('같은 채널에 동일한 검색명이 이미 있습니다', 409)
  }

  // items 변경 시 옵션 소속 검증
  if (input.items) {
    const optionIds = input.items.map((it) => it.optionId)
    const validOptions = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
      select: { id: true },
    })
    if (validOptions.length !== optionIds.length) {
      return errorResponse('일부 옵션을 찾을 수 없습니다', 400)
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.productListing.update({
      where: { id: listingId },
      data: {
        internalCode: input.internalCode === undefined ? undefined : input.internalCode,
        searchName: input.searchName ?? undefined,
        displayName: input.displayName ?? undefined,
        keywords: input.keywords ?? undefined,
        retailPrice: input.retailPrice === undefined ? undefined : input.retailPrice,
        channelAllocation:
          input.channelAllocation === undefined ? undefined : input.channelAllocation,
        status: input.status ?? undefined,
        memo: input.memo === undefined ? undefined : input.memo,
      },
    })
    if (input.items) {
      await tx.productListingItem.deleteMany({ where: { listingId } })
      await tx.productListingItem.createMany({
        data: input.items.map((it, idx) => ({
          listingId,
          optionId: it.optionId,
          quantity: it.quantity,
          sortOrder: it.sortOrder ?? idx,
        })),
      })
    }
  })

  return NextResponse.json({ listing: { id: listingId } })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  await prisma.productListing.delete({ where: { id: listingId } })
  return NextResponse.json({ ok: true })
}
