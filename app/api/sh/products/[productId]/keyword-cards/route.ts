import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ productId: string }> }

type Card = {
  kind: 'channelProduct' | 'listing'
  id: string
  channelId: string
  channelName: string
  externalSource: string | null
  searchName: string
  displayName: string | null
  keywords: string[]
  listingCount: number
}

function toKeywordList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []
}

/**
 * 상품 하나가 나가는 모든 판매채널의 편집 카드.
 *
 * R5: 카드 단위는 "채널상 노출 단위"다 — ChannelProduct 에 묶인 리스팅들은 base 상품명을
 * 공유하므로 카드 하나로 접고, 묶이지 않은 단독 리스팅은 자기 카드를 갖는다.
 * 여러 상품이 섞인 세트 리스팅은 제외한다 — 이 상품의 이름이라 말할 수 없다.
 */
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
      items: { some: { option: { productId, deletedAt: null } } },
    },
    select: {
      id: true,
      channelId: true,
      channelProductId: true,
      searchName: true,
      displayName: true,
      keywords: true,
      channel: { select: { name: true, externalSource: true } },
      channelProduct: {
        select: {
          id: true,
          baseSearchName: true,
          baseDisplayName: true,
          keywords: true,
        },
      },
      items: {
        where: { option: { deletedAt: null } },
        select: { option: { select: { productId: true } } },
      },
    },
    orderBy: [{ channelId: 'asc' }, { updatedAt: 'desc' }],
  })

  const cards = new Map<string, Card>()
  for (const l of listings) {
    // 혼합 세트는 이 상품의 상품명이라 말할 수 없다 — 제외.
    if (new Set(l.items.map((it) => it.option.productId)).size !== 1) continue

    if (l.channelProduct) {
      const key = `cp:${l.channelProduct.id}`
      const hit = cards.get(key)
      if (hit) {
        hit.listingCount += 1
        continue
      }
      cards.set(key, {
        kind: 'channelProduct',
        id: l.channelProduct.id,
        channelId: l.channelId,
        channelName: l.channel.name,
        externalSource: l.channel.externalSource,
        searchName: l.channelProduct.baseSearchName,
        displayName: l.channelProduct.baseDisplayName,
        keywords: toKeywordList(l.channelProduct.keywords),
        listingCount: 1,
      })
      continue
    }

    cards.set(`ls:${l.id}`, {
      kind: 'listing',
      id: l.id,
      channelId: l.channelId,
      channelName: l.channel.name,
      externalSource: l.channel.externalSource,
      searchName: l.searchName,
      displayName: l.displayName,
      keywords: toKeywordList(l.keywords),
      listingCount: 1,
    })
  }

  return NextResponse.json({ cards: [...cards.values()] })
}
