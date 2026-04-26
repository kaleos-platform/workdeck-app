import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productListingSchema } from '@/lib/sh/schemas'
import {
  applyChannelAllocation,
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { productDisplayName } from '@/lib/sh/product-display'

type ListingListRow = {
  id: string
  channelId: string
  searchName: string
  displayName: string
  internalCode: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  retailPrice: number | null // 판매가
  baselinePrice: number | null // 자동 계산 소비자가
  discountAmount: number | null
  discountPercent: number | null
  availableStock: number
  itemCount: number
  items: Array<{
    optionId: string
    optionName: string
    productId: string
    productName: string
    quantity: number
    sortOrder: number
  }>
  updatedAt: string
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const channelId = searchParams.get('channelId')?.trim() || null
  const statusFilter = searchParams.get('status')?.trim() || 'all' // all | ACTIVE | SUSPENDED | SOLD_OUT
  const search = (searchParams.get('search') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  const where: Prisma.ProductListingWhereInput = { spaceId: resolved.space.id }
  if (channelId) where.channelId = channelId
  if (statusFilter === 'ACTIVE' || statusFilter === 'SUSPENDED') where.status = statusFilter
  if (search) {
    where.OR = [
      { searchName: { contains: search, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } },
      { internalCode: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [listings, total] = await Promise.all([
    prisma.productListing.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            option: {
              select: {
                id: true,
                name: true,
                retailPrice: true,
                product: { select: { id: true, name: true, internalName: true, msrp: true } },
              },
            },
          },
        },
      },
    }),
    prisma.productListing.count({ where }),
  ])

  // 해당 페이지 listing들의 전체 옵션 id → 재고 배치 조회
  const optionIds = Array.from(new Set(listings.flatMap((l) => l.items.map((i) => i.optionId))))
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const stockRows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const row of stockRows) {
      stockMap.set(row.optionId, row._sum.quantity ?? 0)
    }
  }

  const rows: ListingListRow[] = listings.map((l) => {
    const priceSnapshots = l.items.map((it) => ({
      quantity: it.quantity,
      retailPrice:
        it.option.retailPrice != null
          ? Number(it.option.retailPrice)
          : it.option.product?.msrp != null
            ? Number(it.option.product.msrp)
            : null,
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
      channelId: l.channelId,
      searchName: l.searchName,
      displayName: l.displayName,
      internalCode: l.internalCode,
      status: l.status,
      effectiveStatus: effective,
      retailPrice,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      availableStock: available,
      autoAvailableStock: autoAvailable,
      channelAllocation: l.channelAllocation,
      itemCount: l.items.length,
      items: l.items.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        productId: it.option.product.id,
        productName: productDisplayName(it.option.product),
        quantity: it.quantity,
        sortOrder: it.sortOrder,
      })),
      updatedAt: l.updatedAt.toISOString(),
    }
  })

  // SOLD_OUT 필터는 클라이언트 후처리 (effective 기준)
  const filtered =
    statusFilter === 'SOLD_OUT' ? rows.filter((r) => r.effectiveStatus === 'SOLD_OUT') : rows

  return NextResponse.json({ data: filtered, total, page, pageSize })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const parsed = productListingSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return errorResponse(first?.message ?? '입력값이 올바르지 않습니다', 400)
  }
  const input = parsed.data

  // 채널 소속 검증
  const channel = await prisma.channel.findFirst({
    where: { id: input.channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  // 옵션 소속 검증 (같은 Space의 상품 옵션이어야 함)
  const optionIds = input.items.map((it) => it.optionId)
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId: resolved.space.id } },
    select: { id: true },
  })
  if (validOptions.length !== optionIds.length) {
    return errorResponse('일부 옵션을 찾을 수 없습니다', 400)
  }

  // 검색명 중복 검증 (같은 채널 내)
  const dup = await prisma.productListing.findFirst({
    where: { channelId: input.channelId, searchName: input.searchName },
    select: { id: true },
  })
  if (dup) return errorResponse('같은 채널에 동일한 검색명이 이미 있습니다', 409)

  const created = await prisma.$transaction(async (tx) => {
    const listing = await tx.productListing.create({
      data: {
        spaceId: resolved.space.id,
        channelId: input.channelId,
        searchName: input.searchName,
        displayName: input.displayName,
        internalCode: input.internalCode ?? null,
        keywords: input.keywords ?? [],
        retailPrice: input.retailPrice ?? null,
        channelAllocation: input.channelAllocation ?? null,
        status: input.status,
        memo: input.memo ?? null,
      },
    })
    await tx.productListingItem.createMany({
      data: input.items.map((it, idx) => ({
        listingId: listing.id,
        optionId: it.optionId,
        quantity: it.quantity,
        sortOrder: it.sortOrder ?? idx,
      })),
    })
    return listing
  })

  return NextResponse.json({ listing: { id: created.id } }, { status: 201 })
}
