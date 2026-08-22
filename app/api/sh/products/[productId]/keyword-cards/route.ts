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
  nameEditable: boolean
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
      // 판매채널이 아닌 채널의 리스팅은 카드로 보여줘도 편집 저장이 400 으로 막힌다
      // (listings/[listingId]/route.ts 의 SALES_CHANNEL_ONLY_MESSAGE 가드) — 애초에 제외한다.
      channel: { channelTypeDef: { isSalesChannel: true } },
    },
    select: {
      id: true,
      channelId: true,
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
        nameEditable: true, // 아래에서 CP 전체 자식 기준으로 교정한다
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
      nameEditable: true, // 전파 대상이 없는 단독 리스팅은 항상 편집 가능
    })
  }

  // channel-products/[id] GET의 kind:'mixed' 판정과 범위를 맞춘다 — 이 상품에 걸친 리스팅만이
  // 아니라 CP 아래 "전체" 자식 리스팅을 기준으로 여러 상품이 섞였는지 재판정해야 한다.
  // 위 루프는 productId 로 필터된 listings 만 보므로, CP 가 다른 상품의 리스팅도 갖고 있으면
  // 놓친다 — mixed CP 를 "단일 상품"으로 오판하는 원래 버그를 여기서 교정한다.
  const cpCards = [...cards.values()].filter((c) => c.kind === 'channelProduct')
  if (cpCards.length > 0) {
    const cpIds = cpCards.map((c) => c.id)
    const cpListings = await prisma.productListing.findMany({
      where: { channelProductId: { in: cpIds } },
      select: {
        channelProductId: true,
        items: {
          where: { option: { deletedAt: null } },
          select: { option: { select: { productId: true } } },
        },
      },
    })
    const productIdsByCp = new Map<string, Set<string>>()
    const listingCountByCp = new Map<string, number>()
    for (const l of cpListings) {
      const cpId = l.channelProductId
      if (!cpId) continue
      listingCountByCp.set(cpId, (listingCountByCp.get(cpId) ?? 0) + 1)
      let set = productIdsByCp.get(cpId)
      if (!set) {
        set = new Set<string>()
        productIdsByCp.set(cpId, set)
      }
      for (const it of l.items) set.add(it.option.productId)
    }
    for (const card of cpCards) {
      card.listingCount = listingCountByCp.get(card.id) ?? card.listingCount
      const productIds = productIdsByCp.get(card.id)
      card.nameEditable = !productIds || productIds.size <= 1
    }
  }

  return NextResponse.json({ cards: [...cards.values()] })
}
