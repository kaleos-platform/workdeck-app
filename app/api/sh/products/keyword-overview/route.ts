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
      },
    }),
    prisma.invProduct.count({ where }),
  ])

  const productIds = rows.map((p) => p.id)
  // 집계는 별도 쿼리로 한다. 상품 select 안에서 옵션→리스팅아이템을 순회하면
  // (a) 같은 리스팅에 이 상품의 옵션이 둘 이상 묶였을 때 리스팅이 중복 집계되고
  // (b) 혼합 세트 여부를 알 수 없다 — 그 리스팅의 "다른 상품 옵션"이 보이지 않기 때문.
  const listings =
    productIds.length === 0
      ? []
      : await prisma.productListing.findMany({
          where: {
            spaceId: resolved.space.id,
            items: { some: { option: { productId: { in: productIds }, deletedAt: null } } },
          },
          select: {
            channelId: true,
            items: {
              where: { option: { deletedAt: null } },
              select: { option: { select: { productId: true } } },
            },
          },
        })

  const productIdSet = new Set(productIds)
  const channelsByProduct = new Map<string, Set<string>>()
  for (const l of listings) {
    const ids = new Set(l.items.map((it) => it.option.productId))
    // 혼합 세트는 세지 않는다 — keyword-cards 가 카드로 만들지 않는 것과 같은 기준이라야
    // 좌측의 "채널 N개" 와 우측 카드 수가 어긋나지 않는다.
    if (ids.size !== 1) continue
    const productId = [...ids][0]
    if (!productIdSet.has(productId)) continue
    if (!channelsByProduct.has(productId)) channelsByProduct.set(productId, new Set())
    channelsByProduct.get(productId)!.add(l.channelId)
  }

  const data = rows.map((p) => ({
    id: p.id,
    name: p.internalName ?? p.name,
    brandName: p.brand?.name ?? null,
    channelCount: channelsByProduct.get(p.id)?.size ?? 0,
  }))

  return NextResponse.json({ data, total, page, pageSize })
}
