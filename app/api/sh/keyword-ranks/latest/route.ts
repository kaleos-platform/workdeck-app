import { NextRequest, NextResponse } from 'next/server'

import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizeKeyword } from '@/lib/sh/keyword-normalize'
import { resolveRankTarget, ymdOf } from '@/lib/rank/target'

/** 대상 하나의 키워드×출처별 최신 순위. key 는 normalizeKeyword(keyword). */
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const targetKey = req.nextUrl.searchParams.get('targetKey')
  if (!(await resolveRankTarget(resolved.space.id, targetKey))) {
    return errorResponse('대상을 찾을 수 없습니다', 404)
  }

  const rows = await prisma.keywordRankSnapshot.findMany({
    where: { spaceId: resolved.space.id, targetKey: targetKey! },
    distinct: ['source', 'keyword'],
    orderBy: { date: 'desc' },
    select: { keyword: true, source: true, status: true, rank: true, date: true },
  })
  return NextResponse.json({
    ranks: rows.map((r) => ({
      keyword: r.keyword,
      key: normalizeKeyword(r.keyword),
      source: r.source,
      status: r.status,
      rank: r.rank,
      date: ymdOf(r.date),
    })),
  })
}
