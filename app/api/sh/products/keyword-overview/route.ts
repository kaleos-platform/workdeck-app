import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/**
 * 상품 축 키워드 화면의 좌측 목록.
 * 판매채널 상품이 하나라도 있는 상품만 보여준다 — 채널에 안 나가는 상품은
 * 이 화면에서 할 일이 없다.
 */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const q = (searchParams.get('q') ?? '').trim()
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 30)))

  const where: Prisma.InvProductWhereInput = {
    spaceId: resolved.space.id,
    status: 'ACTIVE',
    options: { some: { deletedAt: null, listingItems: { some: {} } } },
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { internalName: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [rows, total] = await Promise.all([
    prisma.invProduct.findMany({
      where,
      orderBy: [{ internalName: 'asc' }, { name: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        internalName: true,
        brand: { select: { name: true } },
        options: {
          where: { deletedAt: null },
          select: { listingItems: { select: { listing: { select: { channelId: true } } } } },
        },
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  const data = rows.map((p) => {
    const channelIds = new Set<string>()
    let listingCount = 0
    for (const o of p.options) {
      for (const li of o.listingItems) {
        channelIds.add(li.listing.channelId)
        listingCount += 1
      }
    }
    return {
      id: p.id,
      name: p.internalName ?? p.name,
      brandName: p.brand?.name ?? null,
      channelCount: channelIds.size,
      listingCount,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}
