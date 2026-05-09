import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productDisplayName } from '@/lib/sh/product-display'
import {
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'

/**
 * 채널상품 목록 (GET) + 신규 채널상품 생성 (POST).
 *
 * GET: ChannelProduct 기반 목록 반환. product union(single|mixed) 파생.
 * POST: 채널상품 + 하위 listing들을 트랜잭션으로 일괄 생성.
 *       productId 불필요 — listing의 items에서 product가 결정됨.
 */

// POST body schema
const listingItemSchema = z.object({
  optionId: z.string().min(1),
  quantity: z.number().int().min(1),
  sortOrder: z.number().int().default(0),
})

const listingInputSchema = z.object({
  searchName: z.string().min(1).max(400),
  displayName: z.string().min(1).max(400),
  managementName: z.string().max(400).optional(),
  internalCode: z.string().max(100).optional(),
  memo: z.string().max(1000).optional(),
  retailPrice: z.number().nonnegative().nullable().optional(),
  channelAllocation: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
  items: z.array(listingItemSchema).min(1),
})

const createChannelProductSchema = z.object({
  channelId: z.string().min(1),
  baseSearchName: z.string().min(1).max(400),
  baseDisplayName: z.string().max(400).optional(),
  baseManagementName: z.string().max(400).optional(),
  baseInternalCode: z.string().max(100).optional(),
  memo: z.string().max(1000).optional(),
  keywords: z.array(z.string()).default([]),
  listings: z.array(listingInputSchema).min(1),
})

// product discriminated union 타입
type SingleProduct = {
  kind: 'single'
  id: string
  name: string
  internalName: string | null
  brand: { id: string; name: string } | null
  optionAttributes: Array<{ name: string; values: Array<{ value: string }> }>
  msrp: number | null
}
type MixedProduct = {
  kind: 'mixed'
  products: Array<{ id: string; name: string }>
}
type ProductUnion = SingleProduct | MixedProduct

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const channelId = searchParams.get('channelId')?.trim() || null
  const productId = searchParams.get('productId')?.trim() || null
  const statusFilter = searchParams.get('status')?.trim() || 'all'
  const search = (searchParams.get('search') ?? '').trim()

  // 채널상품 목록 (ChannelProduct 기반)
  const cpWhere: Prisma.ChannelProductWhereInput = {
    spaceId: resolved.space.id,
    channel: { channelTypeDef: { isSalesChannel: true } },
  }
  if (channelId) cpWhere.channelId = channelId
  // productId 필터: listing items를 통해 간접 필터링
  if (productId) {
    cpWhere.listings = { some: { items: { some: { option: { productId } } } } }
  }
  if (search) {
    cpWhere.OR = [
      { baseSearchName: { contains: search, mode: 'insensitive' } },
      { baseManagementName: { contains: search, mode: 'insensitive' } },
    ]
  }

  const channelProducts = await prisma.channelProduct.findMany({
    where: cpWhere,
    orderBy: { updatedAt: 'desc' },
    include: {
      channel: { select: { id: true, name: true } },
      listings: {
        orderBy: { createdAt: 'asc' },
        include: {
          items: {
            orderBy: { sortOrder: 'asc' },
            include: {
              option: {
                select: {
                  id: true,
                  retailPrice: true,
                  productId: true,
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
                  attributeValues: true,
                },
              },
            },
          },
        },
      },
    },
  })

  // 재고 배치 조회
  const optionIds = Array.from(
    new Set(
      channelProducts.flatMap((cp) => cp.listings.flatMap((l) => l.items.map((it) => it.optionId)))
    )
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

  const groups = channelProducts.map((cp) => {
    const listingRows = cp.listings.map((l) => {
      const baseline = computeListingRetailBaseline(
        l.items.map((it) => ({
          quantity: it.quantity,
          retailPrice:
            it.option.retailPrice != null
              ? Number(it.option.retailPrice)
              : it.option.product?.msrp != null
                ? Number(it.option.product.msrp)
                : null,
        }))
      )
      const available = computeListingAvailableStock(
        l.items.map((it) => ({
          quantity: it.quantity,
          optionStock: stockMap.get(it.optionId) ?? 0,
        }))
      )
      const retailPrice = l.retailPrice != null ? Number(l.retailPrice) : null
      return {
        id: l.id,
        searchName: l.searchName,
        displayName: l.displayName,
        managementName: l.managementName,
        internalCode: l.internalCode,
        availableStock: available,
        baselinePrice: baseline,
        retailPrice,
        status: l.status,
        effectiveStatus: computeEffectiveStatus(l.status, available),
      }
    })

    let availableStockSum = 0
    let retailMin: number | null = null
    let retailMax: number | null = null
    let baselineMin: number | null = null
    let baselineMax: number | null = null
    const statusCounts = { ACTIVE: 0, SOLD_OUT: 0, SUSPENDED: 0 }
    for (const lr of listingRows) {
      availableStockSum += lr.availableStock
      retailMin = minNullable(retailMin, lr.retailPrice)
      retailMax = maxNullable(retailMax, lr.retailPrice)
      baselineMin = minNullable(baselineMin, lr.baselinePrice)
      baselineMax = maxNullable(baselineMax, lr.baselinePrice)
      statusCounts[lr.effectiveStatus] += 1
    }

    // product discriminated union 파생
    const allItems = cp.listings.flatMap((l) => l.items)
    const productIds = [...new Set(allItems.map((it) => it.option.productId))]

    let product: ProductUnion
    if (productIds.length === 1) {
      // single product — 대표 옵션의 product 정보 사용
      const repProduct = allItems[0]?.option.product
      const optionAttributes = Array.isArray(repProduct?.optionAttributes)
        ? (repProduct.optionAttributes as Array<{ name: string; values: Array<{ value: string }> }>)
        : []
      product = {
        kind: 'single',
        id: repProduct?.id ?? productIds[0],
        name: repProduct?.name ?? '',
        internalName: repProduct?.internalName ?? null,
        brand: repProduct?.brand ?? null,
        optionAttributes,
        msrp: repProduct?.msrp != null ? Number(repProduct.msrp) : null,
      }
    } else {
      // mixed — 각 unique product의 id/name만
      const seenIds = new Set<string>()
      const mixedProducts: Array<{ id: string; name: string }> = []
      for (const it of allItems) {
        if (!seenIds.has(it.option.productId)) {
          seenIds.add(it.option.productId)
          mixedProducts.push({ id: it.option.productId, name: it.option.product?.name ?? '' })
        }
      }
      product = { kind: 'mixed', products: mixedProducts }
    }

    // backward-compat: productName 필드 유지
    const productName =
      product.kind === 'single'
        ? productDisplayName(product)
        : `혼합 (${product.products.length}개 상품)`

    return {
      kind: 'group' as const,
      id: cp.id,
      product,
      productName,
      channelId: cp.channelId,
      channelName: cp.channel.name,
      baseSearchName: cp.baseSearchName,
      baseManagementName: cp.baseManagementName,
      keywords: Array.isArray(cp.keywords) ? (cp.keywords as string[]) : [],
      listingCount: listingRows.length,
      availableStockSum,
      retailPriceRange: { min: retailMin, max: retailMax },
      baselinePriceRange: { min: baselineMin, max: baselineMax },
      statusCounts,
      listings: listingRows,
    }
  })

  // status 필터 후처리 (effectiveStatus 기준)
  const filteredGroups =
    statusFilter === 'all'
      ? groups
      : groups.filter((g) => g.statusCounts[statusFilter as keyof typeof g.statusCounts] > 0)

  return NextResponse.json({ groups: filteredGroups })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = createChannelProductSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }

  const { channelId, listings: listingInputs, ...cpFields } = parsed.data

  // channel 소속 + 판매채널 검증
  const channel = await prisma.channel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true, channelTypeDef: { select: { isSalesChannel: true } } },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  if (channel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse('판매채널 상품은 판매채널 유형의 채널에만 등록할 수 있습니다', 400)
  }

  // 모든 listing의 optionId 수집 → 한 번에 소속·ACTIVE 검증
  const allOptionIds = [
    ...new Set(listingInputs.flatMap((li) => li.items.map((it) => it.optionId))),
  ]
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: allOptionIds }, product: { spaceId: resolved.space.id, status: 'ACTIVE' } },
    select: { id: true },
  })
  if (validOptions.length !== allOptionIds.length) {
    return errorResponse('일부 옵션을 찾을 수 없거나 미사용 상품에 속해 있습니다', 400)
  }

  let result: {
    channelProduct: { id: string }
    listings: { id: string; searchName: string; status: string }[]
  }
  try {
    result = await prisma.$transaction(async (tx) => {
      const cp = await tx.channelProduct.create({
        data: {
          spaceId: resolved.space.id,
          channelId,
          ...cpFields,
          keywords: cpFields.keywords,
        },
      })

      const createdListings = await Promise.all(
        listingInputs.map((li) =>
          tx.productListing.create({
            data: {
              spaceId: resolved.space.id,
              channelId,
              channelProductId: cp.id,
              searchName: li.searchName,
              displayName: li.displayName,
              managementName: li.managementName,
              internalCode: li.internalCode,
              memo: li.memo,
              retailPrice: li.retailPrice ?? null,
              channelAllocation: li.channelAllocation ?? null,
              status: li.status,
              items: {
                create: li.items.map((it) => ({
                  optionId: it.optionId,
                  quantity: it.quantity,
                  sortOrder: it.sortOrder,
                })),
              },
            },
            select: { id: true, searchName: true, status: true },
          })
        )
      )

      return { channelProduct: cp, listings: createdListings }
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return errorResponse(
        '이 채널상품 안에 같은 검색명이 이미 있습니다. 검색명을 변경해 주세요.',
        409
      )
    }
    throw e
  }

  return NextResponse.json(
    { channelProduct: result.channelProduct, listings: result.listings },
    { status: 201 }
  )
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}
function maxNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}
