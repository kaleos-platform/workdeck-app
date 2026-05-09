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

// product 공통 메타 필드 (single: 해당 product, mixed: 첫 번째 product 기준 backward-compat)
type ProductMeta = {
  id: string
  name: string
  internalName: string | null
  displayName: string
  brand: { id: string; name: string } | null
  optionAttributes: Array<{ name: string; values: Array<{ value: string }> }>
  msrp: number | null
}
type SingleProduct = ProductMeta & { kind: 'single' }
type MixedProduct = ProductMeta & {
  kind: 'mixed'
  products: Array<{ id: string; name: string }>
}
type ProductUnion = SingleProduct | MixedProduct

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const cp = await prisma.channelProduct.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
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
                },
              },
            },
          },
        },
      },
    },
  })
  if (!cp) return errorResponse('채널상품을 찾을 수 없습니다', 404)

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

  // product discriminated union 파생
  const allItems = cp.listings.flatMap((l) => l.items)
  const productIds = [...new Set(allItems.map((it) => it.option.productId))]

  let product: ProductUnion
  if (productIds.length <= 1) {
    // single product (또는 listing 없음)
    const repProduct = allItems[0]?.option.product
    const optionAttributes = Array.isArray(repProduct?.optionAttributes)
      ? (repProduct.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
      : []
    product = {
      kind: 'single',
      id: repProduct?.id ?? '',
      name: repProduct?.name ?? '',
      internalName: repProduct?.internalName ?? null,
      displayName: repProduct ? productDisplayName(repProduct) : '',
      brand: repProduct?.brand ?? null,
      optionAttributes,
      msrp: repProduct?.msrp != null ? Number(repProduct.msrp) : null,
    }
  } else {
    // mixed — backward-compat: id/name/displayName/optionAttributes/brand/msrp를 첫 번째 product 기준으로 채움
    const seenIds = new Set<string>()
    const mixedProducts: Array<{ id: string; name: string }> = []
    for (const it of allItems) {
      if (!seenIds.has(it.option.productId)) {
        seenIds.add(it.option.productId)
        mixedProducts.push({ id: it.option.productId, name: it.option.product?.name ?? '' })
      }
    }
    const repProduct = allItems[0]?.option.product
    const optionAttributes = Array.isArray(repProduct?.optionAttributes)
      ? (repProduct.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
      : []
    product = {
      kind: 'mixed',
      products: mixedProducts,
      // backward-compat fields
      id: repProduct?.id ?? '',
      name: repProduct?.name ?? '',
      internalName: repProduct?.internalName ?? null,
      displayName: repProduct ? productDisplayName(repProduct) : '',
      brand: repProduct?.brand ?? null,
      optionAttributes,
      msrp: repProduct?.msrp != null ? Number(repProduct.msrp) : null,
    }
  }

  const listings = cp.listings.map((l) => {
    // msrp: listing items에서 product msrp 추출 (첫 번째 옵션 기준)
    const firstProductMsrp = l.items[0]?.option.product?.msrp
    const productMsrp = firstProductMsrp != null ? Number(firstProductMsrp) : null

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
    product,
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
  await prisma.channelProduct.delete({ where: { id } })

  return new NextResponse(null, { status: 204 })
}
