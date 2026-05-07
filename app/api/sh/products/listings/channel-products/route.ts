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
 * GET: ChannelProduct 기반 목록 반환. channelProductId 없는 listing은 solo/mixed로 별도 표기.
 * POST: 채널상품 + 하위 listing들을 트랜잭션으로 일괄 생성.
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
  productId: z.string().min(1),
  channelId: z.string().min(1),
  baseSearchName: z.string().min(1).max(400),
  baseDisplayName: z.string().max(400).optional(),
  baseManagementName: z.string().max(400).optional(),
  baseInternalCode: z.string().max(100).optional(),
  memo: z.string().max(1000).optional(),
  keywords: z.array(z.string()).default([]),
  listings: z.array(listingInputSchema).min(1),
})

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
  if (productId) cpWhere.productId = productId
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
      product: {
        select: { id: true, name: true, internalName: true, msrp: true, optionAttributes: true },
      },
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
                  product: { select: { msrp: true } },
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

    return {
      kind: 'group' as const,
      id: cp.id,
      productId: cp.productId,
      productName: productDisplayName(cp.product),
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

  // SOLD_OUT 필터 후처리
  const filteredGroups =
    statusFilter === 'SOLD_OUT' ? groups.filter((g) => g.statusCounts.SOLD_OUT > 0) : groups

  // channelProductId 없는 단독 listing (solo/mixed)
  const soloWhere: Prisma.ProductListingWhereInput = {
    spaceId: resolved.space.id,
    channelProductId: null,
    channel: { channelTypeDef: { isSalesChannel: true } },
  }
  if (channelId) soloWhere.channelId = channelId
  if (statusFilter === 'ACTIVE' || statusFilter === 'SUSPENDED') soloWhere.status = statusFilter
  if (search) {
    soloWhere.OR = [
      { searchName: { contains: search, mode: 'insensitive' } },
      { managementName: { contains: search, mode: 'insensitive' } },
    ]
  }

  const soloListings = await prisma.productListing.findMany({
    where: soloWhere,
    orderBy: { updatedAt: 'desc' },
    include: {
      channel: { select: { id: true, name: true } },
      items: {
        include: {
          option: {
            select: {
              id: true,
              retailPrice: true,
              productId: true,
              product: { select: { msrp: true } },
            },
          },
        },
      },
    },
  })

  const soloOptionIds = Array.from(
    new Set(soloListings.flatMap((l) => l.items.map((it) => it.optionId)))
  )
  if (soloOptionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: soloOptionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) stockMap.set(r.optionId, r._sum.quantity ?? 0)
  }

  const soloRows = soloListings.map((l) => {
    const productIds = new Set(l.items.map((it) => it.option.productId))
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
      l.items.map((it) => ({ quantity: it.quantity, optionStock: stockMap.get(it.optionId) ?? 0 }))
    )
    const retailPrice = l.retailPrice != null ? Number(l.retailPrice) : null
    return {
      kind: (productIds.size === 1 ? 'solo' : 'mixed') as 'solo' | 'mixed',
      id: l.id,
      channelId: l.channelId,
      channelName: l.channel.name,
      searchName: l.searchName,
      displayName: l.displayName,
      managementName: l.managementName,
      availableStock: available,
      baselinePrice: baseline,
      retailPrice,
      status: l.status,
      effectiveStatus: computeEffectiveStatus(l.status, available),
    }
  })

  const filteredSolo =
    statusFilter === 'SOLD_OUT'
      ? soloRows.filter((r) => r.effectiveStatus === 'SOLD_OUT')
      : soloRows

  return NextResponse.json({ groups: filteredGroups, solo: filteredSolo })
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

  const { productId, channelId, listings: listingInputs, ...cpFields } = parsed.data

  // product / channel 소속 검증
  const [product, channel] = await Promise.all([
    prisma.invProduct.findFirst({
      where: { id: productId, spaceId: resolved.space.id },
      select: { id: true },
    }),
    prisma.channel.findFirst({
      where: { id: channelId, spaceId: resolved.space.id },
      select: { id: true, channelTypeDef: { select: { isSalesChannel: true } } },
    }),
  ])
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  if (channel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse('판매채널 상품은 판매채널 유형의 채널에만 등록할 수 있습니다', 400)
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
          productId,
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
        '이미 같은 관리용 상품명이 이 채널에 등록되어 있습니다. 관리용 상품명을 변경해 주세요.',
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
