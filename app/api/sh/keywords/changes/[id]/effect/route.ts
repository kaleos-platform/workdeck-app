import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { formatDateToYmdKst } from '@/lib/date-range'
import { lastClosedDateKst } from '@/lib/sh/sales-analytics'
import { loadProductSales } from '@/lib/sh/product-sales'
import { toKeywordList } from '@/lib/sh/keyword-change'
import { computeEffectWindows, medianRank, NOT_IN_TOP_RANK } from '@/lib/sh/change-effect'
import { ymdOf } from '@/lib/rank/target'

type Params = { params: Promise<{ id: string }> }

const kstStart = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`)
const kstEnd = (ymd: string) => new Date(`${ymd}T23:59:59+09:00`)

/** 변경 전후 14일 비교 — 구성 옵션의 해당 채널 판매(수량·매출) + 키워드 순위 중앙값. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const log = await prisma.keywordChangeLog.findFirst({
    where: { id, spaceId },
    select: {
      createdAt: true,
      listingId: true,
      channelProductId: true,
      beforeKeywords: true,
      afterKeywords: true,
    },
  })
  if (!log) return errorResponse('변경 이력을 찾을 수 없습니다', 404)
  if (!log.listingId && !log.channelProductId) {
    return NextResponse.json({ unavailable: '대상이 기록되지 않은 과거 이력입니다' })
  }

  // 리스팅 변경이면 그 리스팅, 아니면 채널상품 전체 구성이 대상이다.
  const itemWhere = log.listingId
    ? { listingId: log.listingId }
    : { listing: { channelProductId: log.channelProductId } }
  const [items, channel] = await Promise.all([
    prisma.productListingItem.findMany({ where: itemWhere, select: { optionId: true } }),
    log.listingId
      ? prisma.productListing
          .findFirst({
            where: { id: log.listingId, spaceId },
            select: { channel: { select: { id: true, name: true, externalSource: true } } },
          })
          .then((r) => r?.channel ?? null)
      : prisma.channelProduct
          .findFirst({
            where: { id: log.channelProductId!, spaceId },
            select: { channel: { select: { id: true, name: true, externalSource: true } } },
          })
          .then((r) => r?.channel ?? null),
  ])
  if (!channel)
    return NextResponse.json({ unavailable: '대상이 삭제되어 효과를 계산할 수 없습니다' })

  const optionIds = new Set(items.map((i) => i.optionId))
  const win = computeEffectWindows(formatDateToYmdKst(log.createdAt), lastClosedDateKst())

  const sum = async (from: string, to: string) => {
    if (to < from) return { from, to, quantity: 0, revenue: 0 }
    const { rows } = await loadProductSales(spaceId, kstStart(from), kstEnd(to), [channel])
    let quantity = 0
    let revenue = 0
    for (const r of rows) {
      if (r.channelId !== channel.id || !optionIds.has(r.optionId)) continue
      quantity += r.quantity
      revenue += r.revenue
    }
    return { from, to, quantity, revenue }
  }

  // 순위 스냅샷 — 그룹 소속 리스팅은 추적이 채널상품(cp:) 쪽에 걸려 있으므로 둘 다 본다.
  const targetKeys = [
    ...(log.listingId ? [`ls:${log.listingId}`] : []),
    ...(log.channelProductId ? [`cp:${log.channelProductId}`] : []),
  ]
  const keywords = [
    ...new Set([...toKeywordList(log.beforeKeywords), ...toKeywordList(log.afterKeywords)]),
  ]
  const [before, after, snaps] = await Promise.all([
    sum(win.before.from, win.before.to),
    sum(win.after.from, win.after.to),
    prisma.keywordRankSnapshot.findMany({
      where: {
        spaceId,
        targetKey: { in: targetKeys },
        keyword: { in: keywords },
        status: { in: ['RANKED', 'NOT_IN_TOP100'] },
        date: {
          gte: new Date(`${win.before.from}T00:00:00Z`),
          lte: new Date(`${win.after.to}T00:00:00Z`),
        },
      },
      select: { keyword: true, source: true, date: true, status: true, rank: true },
    }),
  ])

  const groups = new Map<string, { keyword: string; source: string; b: number[]; a: number[] }>()
  for (const s of snaps) {
    const g = groups.get(`${s.source}\u0000${s.keyword}`) ?? {
      keyword: s.keyword,
      source: s.source,
      b: [],
      a: [],
    }
    const ymd = ymdOf(s.date)
    const value = s.status === 'RANKED' ? s.rank! : NOT_IN_TOP_RANK
    if (ymd <= win.before.to) g.b.push(value)
    else if (ymd >= win.after.from) g.a.push(value)
    groups.set(`${s.source}\u0000${s.keyword}`, g)
  }

  return NextResponse.json({
    label: `이 구성 옵션의 ${channel.name} 채널 전체 판매`,
    before,
    after: { ...after, observedDays: win.observedDays, complete: win.complete },
    ranks: [...groups.values()].map((g) => ({
      keyword: g.keyword,
      source: g.source,
      before: medianRank(g.b),
      after: medianRank(g.a),
    })),
  })
}
