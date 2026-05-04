import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  computeEffectiveStatus,
  computeListingAvailableStock,
  computeListingRetailBaseline,
} from '@/lib/sh/listing-calc'

type Params = { params: Promise<{ productId: string }> }

/**
 * 상품 상세의 "판매채널 현황" 섹션에서 사용.
 * 해당 상품이 단일 product로 포함된 listing을 productId × channelId 단위로 그룹화해 반환.
 * 다른 상품이 함께 들어간 혼합 listing은 mixed로 별도 표기.
 */

type ListingRow = {
  id: string
  searchName: string
  displayName: string
  managementName: string | null
  retailPrice: number | null
  baselinePrice: number | null
  availableStock: number
  channelAllocation: number | null
  status: 'ACTIVE' | 'SUSPENDED'
  effectiveStatus: 'ACTIVE' | 'SOLD_OUT' | 'SUSPENDED'
  myOptionsInListing: Array<{ optionId: string; optionName: string; quantity: number }>
}

type GroupRow = {
  channelId: string
  channelName: string
  listingCount: number
  availableStockSum: number
  retailPriceRange: { min: number | null; max: number | null }
  baselinePriceRange: { min: number | null; max: number | null }
  statusCounts: { ACTIVE: number; SOLD_OUT: number; SUSPENDED: number }
  listings: ListingRow[]
}

type MixedRow = ListingRow & { channelId: string; channelName: string }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params

  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const listings = await prisma.productListing.findMany({
    where: {
      spaceId: resolved.space.id,
      items: { some: { option: { productId } } },
    },
    include: {
      channel: { select: { id: true, name: true } },
      items: {
        include: {
          option: {
            select: {
              id: true,
              name: true,
              productId: true,
              retailPrice: true,
              product: { select: { msrp: true } },
            },
          },
        },
      },
    },
    orderBy: [{ channelId: 'asc' }, { updatedAt: 'desc' }],
  })

  const optionIds = Array.from(new Set(listings.flatMap((l) => l.items.map((i) => i.optionId))))
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
  const mixed: MixedRow[] = []

  for (const l of listings) {
    const distinctProductIds = new Set(l.items.map((it) => it.option.productId))
    const mine = l.items.filter((it) => it.option.productId === productId)
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
    const effective = computeEffectiveStatus(l.status, available)

    const row: ListingRow = {
      id: l.id,
      searchName: l.searchName,
      displayName: l.displayName,
      managementName: l.managementName,
      retailPrice,
      baselinePrice: baseline,
      availableStock: available,
      channelAllocation: l.channelAllocation,
      status: l.status,
      effectiveStatus: effective,
      myOptionsInListing: mine.map((it) => ({
        optionId: it.optionId,
        optionName: it.option.name,
        quantity: it.quantity,
      })),
    }

    if (distinctProductIds.size !== 1) {
      mixed.push({ ...row, channelId: l.channelId, channelName: l.channel.name })
      continue
    }

    const existing = groupsMap.get(l.channelId)
    if (!existing) {
      groupsMap.set(l.channelId, {
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
        listings: [row],
      })
    } else {
      existing.listingCount += 1
      existing.availableStockSum += available
      existing.retailPriceRange.min = minOfNullable(existing.retailPriceRange.min, retailPrice)
      existing.retailPriceRange.max = maxOfNullable(existing.retailPriceRange.max, retailPrice)
      existing.baselinePriceRange.min = minOfNullable(existing.baselinePriceRange.min, baseline)
      existing.baselinePriceRange.max = maxOfNullable(existing.baselinePriceRange.max, baseline)
      existing.statusCounts[effective] += 1
      existing.listings.push(row)
    }
  }

  return NextResponse.json({
    groups: Array.from(groupsMap.values()),
    mixed,
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
