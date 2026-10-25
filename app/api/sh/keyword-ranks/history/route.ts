import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { addDaysYmd } from '@/lib/sh/sales-analytics'
import { getTodayStrKst } from '@/lib/date-range'
import { parseTargetKey, resolveRankTarget, ymdOf } from '@/lib/rank/target'

/** 대상·키워드 하나의 순위 시계열 + 같은 대상의 상품명·검색어 변경 이력. */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const targetKey = sp.get('targetKey')
  const keyword = sp.get('keyword')
  if (!keyword) return errorResponse('keyword 가 필요합니다', 400)
  const target = parseTargetKey(targetKey)
  if (!target || !(await resolveRankTarget(spaceId, targetKey))) {
    return errorResponse('대상을 찾을 수 없습니다', 404)
  }
  const days = Math.min(Math.max(Number(sp.get('days')) || 90, 1), 365)
  const fromYmd = addDaysYmd(getTodayStrKst(), -days)

  const [points, changes] = await Promise.all([
    prisma.keywordRankSnapshot.findMany({
      where: {
        spaceId,
        targetKey: targetKey!,
        keyword,
        date: { gte: new Date(`${fromYmd}T00:00:00Z`) },
      },
      orderBy: { date: 'asc' },
      select: { date: true, source: true, status: true, rank: true },
    }),
    prisma.keywordChangeLog.findMany({
      where: {
        spaceId,
        ...(target.kind === 'channelProduct'
          ? { channelProductId: target.id }
          : { listingId: target.id }),
        createdAt: { gte: new Date(`${fromYmd}T00:00:00+09:00`) },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        beforeName: true,
        afterName: true,
        beforeKeywords: true,
        afterKeywords: true,
      },
    }),
  ])
  return NextResponse.json({
    points: points.map((p) => ({ ...p, date: ymdOf(p.date) })),
    changes,
  })
}
