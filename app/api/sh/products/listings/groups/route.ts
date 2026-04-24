import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productDisplayName } from '@/lib/sh/product-display'
import {
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'

/**
 * 판매채널 상품 목록(그룹 단위).
 *
 * 한 상품(InvProduct) × 채널(Channel)에 속한 단일-product listing들을 하나의 그룹 row로 반환.
 * 혼합 구성(listing.items에 여러 product)은 `mixed: true` 행으로 별도 표기 (listing 개별 단위).
 */

type GroupRow = {
  kind: 'group'
  productId: string
  productName: string
  channelId: string
  channelName: string
  listingCount: number
  availableStockSum: number
  retailPriceRange: { min: number | null; max: number | null }
  baselinePriceRange: { min: number | null; max: number | null }
  statusCounts: { ACTIVE: number; SOLD_OUT: number; SUSPENDED: number }
  listings: Array<{
    id: string
    searchName: string
    displayName: string
    internalCode: string | null
    availableStock: number
    baselinePrice: number | null
    retailPrice: number | null
    status: 'ACTIVE' | 'SUSPENDED'
    effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  }>
}

type MixedRow = {
  kind: 'mixed'
  id: string
  channelId: string
  channelName: string
  searchName: string
  displayName: string
  availableStock: number
  baselinePrice: number | null
  retailPrice: number | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const channelId = searchParams.get('channelId')?.trim() || null
  const statusFilter = searchParams.get('status')?.trim() || 'all'
  const search = (searchParams.get('search') ?? '').trim()

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

  const listings = await prisma.productListing.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      channel: { select: { id: true, name: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          option: {
            select: {
              id: true,
              retailPrice: true,
              productId: true,
              product: { select: { id: true, name: true, internalName: true } },
            },
          },
        },
      },
    },
  })

  // 재고 배치 조회
  const optionIds = Array.from(new Set(listings.flatMap((l) => l.items.map((it) => it.optionId))))
  const stockMap = new Map<string, number>()
  if (optionIds.length > 0) {
    const rows = await prisma.invStockLevel.groupBy({
      by: ['optionId'],
      where: { optionId: { in: optionIds } },
      _sum: { quantity: true },
    })
    for (const r of rows) stockMap.set(r.optionId, r._sum.quantity ?? 0)
  }

  const groupsMap = new Map<string, GroupRow>()
  const mixedRows: MixedRow[] = []

  for (const l of listings) {
    const productIds = new Set(l.items.map((it) => it.option.productId))
    const baseline = computeListingRetailBaseline(
      l.items.map((it) => ({
        quantity: it.quantity,
        retailPrice: it.option.retailPrice != null ? Number(it.option.retailPrice) : null,
      }))
    )
    const available = computeListingAvailableStock(
      l.items.map((it) => ({ quantity: it.quantity, optionStock: stockMap.get(it.optionId) ?? 0 }))
    )
    const retailPrice = l.retailPrice != null ? Number(l.retailPrice) : null
    const effective = computeEffectiveStatus(l.status, available)

    if (productIds.size !== 1) {
      mixedRows.push({
        kind: 'mixed',
        id: l.id,
        channelId: l.channelId,
        channelName: l.channel.name,
        searchName: l.searchName,
        displayName: l.displayName,
        availableStock: available,
        baselinePrice: baseline,
        retailPrice,
        status: l.status,
        effectiveStatus: effective,
      })
      continue
    }

    const product = l.items[0].option.product
    const key = `${product.id}:${l.channelId}`
    const existing = groupsMap.get(key)
    const listingRow = {
      id: l.id,
      searchName: l.searchName,
      displayName: l.displayName,
      internalCode: l.internalCode,
      availableStock: available,
      baselinePrice: baseline,
      retailPrice,
      status: l.status,
      effectiveStatus: effective,
    }
    if (!existing) {
      groupsMap.set(key, {
        kind: 'group',
        productId: product.id,
        productName: productDisplayName(product),
        channelId: l.channelId,
        channelName: l.channel.name,
        listingCount: 1,
        availableStockSum: available,
        retailPriceRange: { min: retailPrice, max: retailPrice },
        baselinePriceRange: { min: baseline, max: baseline },
        statusCounts: {
          ACTIVE: effective === 'ACTIVE' ? 1 : 0,
          SOLD_OUT: effective === 'SOLD_OUT' ? 1 : 0,
          SUSPENDED: effective === 'SUSPENDED' ? 1 : 0,
        },
        listings: [listingRow],
      })
    } else {
      existing.listingCount += 1
      existing.availableStockSum += available
      existing.retailPriceRange.min = minOfNullable(existing.retailPriceRange.min, retailPrice)
      existing.retailPriceRange.max = maxOfNullable(existing.retailPriceRange.max, retailPrice)
      existing.baselinePriceRange.min = minOfNullable(existing.baselinePriceRange.min, baseline)
      existing.baselinePriceRange.max = maxOfNullable(existing.baselinePriceRange.max, baseline)
      existing.statusCounts[effective] += 1
      existing.listings.push(listingRow)
    }
  }

  const groups = Array.from(groupsMap.values())

  // SOLD_OUT 필터 후처리 (effective 기준)
  const filteredGroups =
    statusFilter === 'SOLD_OUT' ? groups.filter((g) => g.statusCounts.SOLD_OUT > 0) : groups
  const filteredMixed =
    statusFilter === 'SOLD_OUT'
      ? mixedRows.filter((m) => m.effectiveStatus === 'SOLD_OUT')
      : mixedRows

  return NextResponse.json({
    groups: filteredGroups,
    mixed: filteredMixed,
  })
}

function minOfNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.min(a, b)
}
function maxOfNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}
