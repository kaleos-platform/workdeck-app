import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productListingSchema } from '@/lib/sh/schemas'
import {
  computeDiscount,
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'
import { productDisplayName } from '@/lib/sh/product-display'

const SALES_CHANNEL_ONLY_MESSAGE = '판매채널 상품은 판매채널 유형의 채널에만 등록할 수 있습니다'

function normalizeDisplayName(searchName: string, displayName?: string) {
  const trimmedSearchName = searchName.trim()
  const trimmedDisplayName = displayName?.trim() ?? ''
  return trimmedDisplayName || trimmedSearchName
}

type SingleProduct = { kind: 'single'; id: string; name: string; displayName: string }
type MixedProduct = { kind: 'mixed'; products: Array<{ id: string; name: string }> }
type ProductUnion = SingleProduct | MixedProduct

type ListingListRow = {
  id: string
  channelId: string
  channelProductId: string | null
  searchName: string
  displayName: string
  managementName: string | null
  internalCode: string | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  retailPrice: number | null // 판매가
  baselinePrice: number | null // 자동 계산 소비자가
  discountAmount: number | null
  discountPercent: number | null
  availableStock: number
  itemCount: number
  product: ProductUnion
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

  // SOLD_OUT은 파생 상태(DB에 직접 저장 안 됨) — 후보는 status='ACTIVE' listing 뿐
  const isSoldOut = statusFilter === 'SOLD_OUT'

  const where: Prisma.ProductListingWhereInput = {
    spaceId: resolved.space.id,
    channel: { channelTypeDef: { isSalesChannel: true } },
  }
  if (channelId) where.channelId = channelId
  if (statusFilter === 'ACTIVE' || statusFilter === 'SUSPENDED') where.status = statusFilter
  // SOLD_OUT은 ACTIVE listing에서만 발생하므로 후보를 ACTIVE로 한정
  if (isSoldOut) where.status = 'ACTIVE'
  if (search) {
    where.OR = [
      { searchName: { contains: search, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } },
      { managementName: { contains: search, mode: 'insensitive' } },
      { internalCode: { contains: search, mode: 'insensitive' } },
    ]
  }

  const listingInclude = {
    items: {
      orderBy: { sortOrder: 'asc' as const },
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
  }

  let listings: Awaited<
    ReturnType<typeof prisma.productListing.findMany<{ include: typeof listingInclude }>>
  >
  let total: number

  if (isSoldOut) {
    // SOLD_OUT은 파생 상태라 DB 필터 불가 → ACTIVE 후보 전체 계산 후 in-memory 페이지네이션
    listings = await prisma.productListing.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: listingInclude,
    })
    // total/data는 아래 매핑 후 결정 (placeholder; isSoldOut 분기에서 덮어씀)
    total = 0
  } else {
    const [found, count] = await Promise.all([
      prisma.productListing.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listingInclude,
      }),
      prisma.productListing.count({ where }),
    ])
    listings = found
    total = count
  }

  // listing들의 옵션 id → 재고 배치 조회
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
    const available = computeListingAvailableStock(stockSnapshots)
    const effective = computeEffectiveStatus(l.status, available, l.channelStock)
    const { diff, percent } = computeDiscount(baseline, retailPrice)

    // product discriminated union 파생
    const uniqueProductIds = [...new Set(l.items.map((it) => it.option.product.id))]
    let product: ProductUnion
    if (uniqueProductIds.length === 1) {
      const p = l.items[0].option.product
      product = { kind: 'single', id: p.id, name: p.name, displayName: productDisplayName(p) }
    } else {
      const seenIds = new Set<string>()
      const mixedProducts: Array<{ id: string; name: string }> = []
      for (const it of l.items) {
        if (!seenIds.has(it.option.product.id)) {
          seenIds.add(it.option.product.id)
          mixedProducts.push({ id: it.option.product.id, name: it.option.product.name })
        }
      }
      product = { kind: 'mixed', products: mixedProducts }
    }

    return {
      id: l.id,
      channelId: l.channelId,
      channelProductId: l.channelProductId,
      searchName: l.searchName,
      displayName: l.displayName,
      managementName: l.managementName,
      internalCode: l.internalCode,
      status: l.status,
      effectiveStatus: effective,
      retailPrice,
      baselinePrice: baseline,
      discountAmount: diff,
      discountPercent: percent,
      availableStock: available,
      autoAvailableStock: available,
      channelStock: l.channelStock,
      itemCount: l.items.length,
      product,
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

  if (isSoldOut) {
    // SOLD_OUT in-memory 페이지네이션: effectiveStatus 기준 필터 후 슬라이스
    const soldOutRows = rows.filter((r) => r.effectiveStatus === 'SOLD_OUT')
    total = soldOutRows.length
    const data = soldOutRows.slice((page - 1) * pageSize, page * pageSize)
    return NextResponse.json({ data, total, page, pageSize })
  }

  return NextResponse.json({ data: rows, total, page, pageSize })
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
  const displayName = normalizeDisplayName(input.searchName, input.displayName)

  // channelProductId 필수 검증
  if (!input.channelProductId) {
    return errorResponse('채널상품을 지정해주세요', 400)
  }

  // channelProduct 소속 + 채널 일치 검증
  const channelProduct = await prisma.channelProduct.findFirst({
    where: { id: input.channelProductId, spaceId: resolved.space.id },
    select: {
      id: true,
      channelId: true,
      channel: { select: { channelTypeDef: { select: { isSalesChannel: true } } } },
    },
  })
  if (!channelProduct) return errorResponse('채널상품을 찾을 수 없습니다', 404)
  if (channelProduct.channel.channelTypeDef?.isSalesChannel !== true) {
    return errorResponse(SALES_CHANNEL_ONLY_MESSAGE, 400)
  }

  // 옵션 소속 검증 (같은 Space의 상품 옵션이어야 함)
  const optionIds = input.items.map((it) => it.optionId)
  const validOptions = await prisma.invProductOption.findMany({
    where: { id: { in: optionIds }, product: { spaceId: resolved.space.id, status: 'ACTIVE' } },
    select: { id: true },
  })
  if (validOptions.length !== optionIds.length) {
    return errorResponse('일부 옵션을 찾을 수 없거나 미사용 상품에 속해 있습니다', 400)
  }

  const created = await prisma.$transaction(async (tx) => {
    const listing = await tx.productListing.create({
      data: {
        spaceId: resolved.space.id,
        channelId: channelProduct.channelId,
        channelProductId: input.channelProductId,
        searchName: input.searchName,
        displayName,
        managementName: input.managementName ?? null,
        internalCode: input.internalCode ?? null,
        keywords: input.keywords ?? [],
        retailPrice: input.retailPrice ?? null,
        channelStock: input.channelStock ?? null,
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
