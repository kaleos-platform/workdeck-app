import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

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

/**
 * 채널상품 단건 조회(GET) / 수정(PATCH) / 삭제(DELETE).
 */

type Params = { params: Promise<{ id: string }> }

const patchSchema = z.object({
  baseSearchName: z.string().min(1).max(400).optional(),
  baseDisplayName: z.string().max(400).nullable().optional(),
  baseManagementName: z.string().max(400).nullable().optional(),
  baseInternalCode: z.string().max(100).nullable().optional(),
  memo: z.string().max(1000).nullable().optional(),
  keywords: z.array(z.string()).optional(),
})

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          internalName: true,
          msrp: true,
          optionAttributes: true,
          brand: { select: { id: true, name: true } },
        },
      },
      channel: {
        select: {
          id: true,
          name: true,
          channelTypeDef: { select: { id: true, name: true, isSalesChannel: true } },
        },
      },
      listings: {
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
      },
    },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

  const productMsrp = cp.product.msrp != null ? Number(cp.product.msrp) : null

  // 재고 배치 조회
  const optionIds = Array.from(
    new Set(cp.listings.flatMap((l) => l.items.map((it) => it.optionId)))
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

  const listings = cp.listings.map((l) => {
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
      managementName: l.managementName,
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

  const optionAttributes = Array.isArray(cp.product.optionAttributes)
    ? (cp.product.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
    : []

  return NextResponse.json({
    channelProduct: {
      id: cp.id,
      baseSearchName: cp.baseSearchName,
      baseDisplayName: cp.baseDisplayName,
      baseManagementName: cp.baseManagementName,
      baseInternalCode: cp.baseInternalCode,
      memo: cp.memo,
      keywords: Array.isArray(cp.keywords) ? (cp.keywords as string[]) : [],
    },
    product: {
      id: cp.product.id,
      name: cp.product.name,
      internalName: cp.product.internalName,
      displayName: productDisplayName(cp.product),
      brand: cp.product.brand,
      optionAttributes,
    },
    channel: {
      id: cp.channel.id,
      name: cp.channel.name,
      channelTypeDef: cp.channel.channelTypeDef,
    },
    listings,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }

  const updated = await prisma.channelProduct.update({
    where: { id },
    data: parsed.data,
    select: {
      id: true,
      baseSearchName: true,
      baseDisplayName: true,
      baseManagementName: true,
      baseInternalCode: true,
      memo: true,
      keywords: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ channelProduct: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

  // listings는 channelProductId FK가 SetNull이므로 채널상품 삭제 시 자동 해제됨
  // listings 자체를 삭제하려면 cascade가 필요하나 현재 정책은 listing 보존
  await prisma.channelProduct.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}
