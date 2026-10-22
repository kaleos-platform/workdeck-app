import { NextResponse } from 'next/server'

import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { addDaysYmd } from '@/lib/sh/sales-analytics'
import { getTodayStrKst } from '@/lib/date-range'
import { toKeywordList } from '@/lib/sh/keyword-change'
import { rankSourceForUrl } from '@/lib/rank/naver-shopping'
import { countRankSlots, getRankSlotLimit } from '@/lib/rank/slots'
import { ymdOf } from '@/lib/rank/target'

type Point = { date: string; status: string; rank: number | null }

/** 추적 중인 대상별·키워드별 최신 순위 + 7일 전 비교 스냅샷. */
export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const [cps, listings, slotsUsed] = await Promise.all([
    prisma.channelProduct.findMany({
      where: { spaceId, rankTracking: true },
      select: {
        id: true,
        baseSearchName: true,
        baseManagementName: true,
        pageUrl: true,
        keywords: true,
        channel: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.productListing.findMany({
      where: { spaceId, rankTracking: true, channelProductId: null },
      select: {
        id: true,
        searchName: true,
        managementName: true,
        pageUrl: true,
        keywords: true,
        channel: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    countRankSlots(spaceId),
  ])

  const targets = [
    ...cps.map((t) => ({
      targetKey: `cp:${t.id}`,
      kind: 'channelProduct' as const,
      id: t.id,
      name: t.baseManagementName ?? t.baseSearchName,
      channelName: t.channel.name,
      pageUrl: t.pageUrl,
      keywords: t.keywords,
    })),
    ...listings.map((t) => ({
      targetKey: `ls:${t.id}`,
      kind: 'listing' as const,
      id: t.id,
      name: t.managementName ?? t.searchName,
      channelName: t.channel.name,
      pageUrl: t.pageUrl,
      keywords: t.keywords,
    })),
  ]

  // 7일 전 비교까지 필요하므로 최근 30일이면 충분하다(최신이 그 안에 없으면 stale 로 본다).
  const since = new Date(`${addDaysYmd(getTodayStrKst(), -30)}T00:00:00Z`)
  const snaps = targets.length
    ? await prisma.keywordRankSnapshot.findMany({
        where: {
          spaceId,
          targetKey: { in: targets.map((t) => t.targetKey) },
          date: { gte: since },
        },
        select: {
          targetKey: true,
          source: true,
          keyword: true,
          date: true,
          status: true,
          rank: true,
        },
        orderBy: { date: 'desc' },
      })
    : []
  const byKey = new Map<string, Array<Point & { source: string }>>()
  for (const s of snaps) {
    const k = `${s.targetKey}\u0000${s.keyword}`
    byKey.set(k, [
      ...(byKey.get(k) ?? []),
      { source: s.source, date: ymdOf(s.date), status: s.status, rank: s.rank },
    ])
  }

  return NextResponse.json({
    slotLimit: getRankSlotLimit(),
    slotsUsed,
    targets: targets.map(({ keywords, ...t }) => {
      const source = rankSourceForUrl(t.pageUrl)
      return {
        ...t,
        source,
        keywords: toKeywordList(keywords).map((keyword) => {
          // 대상의 출처(URL 호스트)에 해당하는 스냅샷만 본다. 날짜 내림차순으로 정렬돼 있다.
          const rows = (byKey.get(`${t.targetKey}\u0000${keyword}`) ?? []).filter(
            (r) => r.source === source
          )
          const pick = ({ date, status, rank }: Point): Point => ({ date, status, rank })
          const latest = rows[0] ?? null
          let prev7: Point | null = null
          if (latest) {
            const goal = addDaysYmd(latest.date, -7)
            const dist = (r: Point) => Math.abs(Date.parse(r.date) - Date.parse(goal))
            const older = rows.filter((r) => r.date < latest.date)
            prev7 = older.length ? pick(older.reduce((a, b) => (dist(b) < dist(a) ? b : a))) : null
          }
          return { keyword, latest: latest ? pick(latest) : null, prev7 }
        }),
      }
    }),
  })
}
