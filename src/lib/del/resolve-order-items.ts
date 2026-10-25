import { prisma } from '@/lib/prisma'
import { buildAliasLookup, normalizeAlias, type MatchTarget } from '@/lib/sh/product-matching'

export type ResolvedItem = {
  name: string
  quantity: number
  optionId: string | null
  listingId: string | null
  fulfillments: Array<{ optionId: string; quantity: number }>
}

/**
 * 채널별 상품 별칭으로 주문 품목을 해석하는 resolver 를 만든다.
 * channelIds 는 우선순위 순 — 앞 채널에 별칭이 없으면 다음 채널로 폴백한다.
 * 우선순위: fulfillments(다중 수동) > listing > option
 */
export async function loadItemResolver(
  spaceId: string,
  channelIds: string[],
  rawNames: string[]
): Promise<(rawName: string, qty: number) => ResolvedItem> {
  const lookups: Array<Map<string, MatchTarget>> = []
  const listingItemsMap = new Map<string, Array<{ optionId: string; quantity: number }>>()

  const uniqueNames = Array.from(new Set(rawNames.filter(Boolean).map(normalizeAlias)))
  if (channelIds.length > 0 && uniqueNames.length > 0) {
    for (const channelId of channelIds) {
      const aliasRows = await prisma.channelProductAlias.findMany({
        where: { channelId, aliasName: { in: uniqueNames } },
        select: {
          aliasName: true,
          optionId: true,
          listingId: true,
          fulfillments: { select: { optionId: true, quantity: true } },
        },
      })
      lookups.push(
        buildAliasLookup(
          aliasRows.map((r) => ({
            aliasName: r.aliasName,
            optionId: r.optionId,
            listingId: r.listingId,
            fulfillments:
              r.fulfillments.length > 0
                ? r.fulfillments.map((f) => ({ optionId: f.optionId, quantity: f.quantity }))
                : null,
          }))
        )
      )
    }

    // listing 매칭에 필요한 item 구성 정보 로드
    const listingIds = Array.from(
      new Set(
        lookups
          .flatMap((m) => Array.from(m.values()))
          .map((t) => t.listingId)
          .filter((v): v is string => !!v)
      )
    )
    if (listingIds.length > 0) {
      const listings = await prisma.productListing.findMany({
        where: { id: { in: listingIds }, spaceId },
        include: { items: { select: { optionId: true, quantity: true } } },
      })
      for (const l of listings) listingItemsMap.set(l.id, l.items)
    }
  }

  return (rawName, qty) => {
    const key = normalizeAlias(rawName)
    const target = lookups.map((m) => m.get(key)).find((t) => t !== undefined)
    const base = { name: rawName, quantity: qty, optionId: null, listingId: null }
    if (target?.fulfillments && target.fulfillments.length > 0) {
      // alias.quantity는 "1 주문당 perSet" → 주문 수량만큼 곱함
      return {
        ...base,
        fulfillments: target.fulfillments.map((f) => ({
          optionId: f.optionId,
          quantity: f.quantity * qty,
        })),
      }
    }
    if (target?.listingId) {
      const listingItems = listingItemsMap.get(target.listingId) ?? []
      return {
        ...base,
        listingId: target.listingId,
        fulfillments: listingItems.map((li) => ({
          optionId: li.optionId,
          quantity: li.quantity * qty,
        })),
      }
    }
    if (target?.optionId) return { ...base, optionId: target.optionId, fulfillments: [] }
    return { ...base, fulfillments: [] }
  }
}
