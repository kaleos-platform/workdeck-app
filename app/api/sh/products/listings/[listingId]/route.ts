import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productListingPatchSchema } from '@/lib/sh/schemas'
import {
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { productDisplayName } from '@/lib/sh/product-display'

type Params = { params: Promise<{ listingId: string }> }
const SALES_CHANNEL_ONLY_MESSAGE = '판매채널 상품은 판매채널 유형의 채널에만 등록할 수 있습니다'

function normalizeDisplayName(searchName: string, displayName?: string) {
  const trimmedSearchName = searchName.trim()
  const trimmedDisplayName = displayName?.trim() ?? ''
  return trimmedDisplayName || trimmedSearchName
}

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { listingId } = await params

  const listing = await prisma.productListing.findFirst({
    where: { id: listingId, spaceId: resolved.space.id },
    include: {
      channelProduct: { select: { id: true } },
      channel: {
        select: {
          id: true,
          name: true,
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
        },
      },
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
  const available = computeListingAvailableStock(stockSnapshots)
  const effective = computeEffectiveStatus(listing.status, available, listing.channelStock)
  const { diff, percent } = computeDiscount(baseline, retailPrice)

  return NextResponse.json({
    listing: {
      id: listing.id,
      channelProductId: listing.channelProduct?.id ?? null,
      channel: listing.channel,
      internalCode: listing.internalCode,
      searchName: listing.searchName,
      displayName: listing.displayName,
      managementName: listing.managementName,
      keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
      retailPrice,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      status: listing.status,
      effectiveStatus: effective,
      availableStock: available,
      autoAvailableStock: available,
      channelStock: listing.channelStock,
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
    select: {
      id: true,
      channelId: true,
      channelProductId: true,
      searchName: true,
      managementName: true,
      channel: {
        select: { externalSource: true, channelTypeDef: { select: { isSalesChannel: true } } },
      },
    },
  })
  if (!existing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)
  if (existing.channel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse(SALES_CHANNEL_ONLY_MESSAGE, 400)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = productListingPatchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 채널 자체 배송(연동) 채널은 채널 재고를 수동 수정할 수 없다 (연동 데이터로 자동 처리).
  if (input.channelStock !== undefined && existing.channel.externalSource != null) {
    return errorResponse('채널 자체 배송 채널은 채널 재고를 수동 수정할 수 없습니다', 400)
  }
  const nextSearchName = input.searchName ?? existing.searchName
  const nextDisplayName =
    input.displayName === undefined
      ? undefined
      : normalizeDisplayName(nextSearchName, input.displayName)

  // items 변경 시 옵션 소속 검증
  if (input.items) {
    const optionIds = input.items.map((it) => it.optionId)
    const validOptions = await prisma.invProductOption.findMany({
      where: { id: { in: optionIds }, product: { spaceId: resolved.space.id, status: 'ACTIVE' } },
      select: { id: true },
    })
    if (validOptions.length !== optionIds.length) {
      return errorResponse('일부 옵션을 찾을 수 없거나 미사용 상품에 속해 있습니다', 400)
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.productListing.update({
      where: { id: listingId },
      data: {
        internalCode: input.internalCode === undefined ? undefined : input.internalCode,
        searchName: input.searchName ?? undefined,
        displayName: nextDisplayName,
        managementName: input.managementName === undefined ? undefined : input.managementName,
        keywords: input.keywords ?? undefined,
        retailPrice: input.retailPrice === undefined ? undefined : input.retailPrice,
        channelStock: input.channelStock === undefined ? undefined : input.channelStock,
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
    select: { id: true, channelProductId: true },
  })
  if (!listing) return errorResponse('판매채널 상품을 찾을 수 없습니다', 404)

  // FK Restrict(ProductionRunSet 등) 참조 시 P2003 — 연결 해제 전 삭제 불가
  try {
    await prisma.productListing.delete({ where: { id: listingId } })
  } catch (e) {
    if ((e as { code?: string }).code === 'P2003') {
      return errorResponse(
        '생산 차수 등에서 사용 중이라 삭제할 수 없습니다. 연결을 먼저 해제하세요',
        409
      )
    }
    throw e
  }

  if (listing.channelProductId) {
    const remaining = await prisma.productListing.count({
      where: { channelProductId: listing.channelProductId },
    })
    if (remaining === 0) {
      await prisma.channelProduct.delete({ where: { id: listing.channelProductId } })
    }
  }

  return NextResponse.json({ ok: true })
}
