import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import { calculateCTR, calculateCVR, calculateROAS } from '@/lib/metrics-calculator'
import { parseKeywordQuery, type KeywordSortKey } from '@/lib/coupang-ads/keyword-query'

type KeywordRow = {
  keyword: string
  adCost: unknown
  impressions: unknown
  clicks: unknown
  orders1d: unknown
  revenue1d: unknown
  removedAt: Date | null
  total: bigint
}

const SORT_SQL: Record<KeywordSortKey, string> = {
  keyword: '"keyword"',
  adCost: '"adCost"',
  ctr: 'CASE WHEN impressions > 0 THEN clicks::numeric / impressions ELSE NULL END',
  cvr: 'CASE WHEN clicks > 0 THEN "orders1d"::numeric / clicks ELSE NULL END',
  roas: 'CASE WHEN "adCost" > 0 THEN "revenue1d" / "adCost" ELSE NULL END',
  orders1d: '"orders1d"',
  revenue1d: '"revenue1d"',
}

// GET /api/campaigns/[campaignId]/inefficient-keywords
// 캠페인 키워드 집계 (기본: 전체, filter 파라미터로 필터링 가능)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const { searchParams } = request.nextUrl

  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const adType = searchParams.get('adType')
  const query = parseKeywordQuery(searchParams)

  // 날짜 필터 조건 구성
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
  if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

  const conditions = ['a."workspaceId" = $1', 'a."campaignId" = $2', 'a.keyword IS NOT NULL']
  const values: unknown[] = [workspace.id, campaignId]

  if (dateFilter.gte) {
    values.push(dateFilter.gte)
    conditions.push(`a.date >= $${values.length}`)
  }
  if (dateFilter.lte) {
    values.push(dateFilter.lte)
    conditions.push(`a.date <= $${values.length}`)
  }
  if (adType && adType !== 'all') {
    values.push(adType)
    conditions.push(`a."adType" = $${values.length}`)
  }
  if (query.search) {
    values.push(`%${query.search}%`)
    conditions.push(`a.keyword ILIKE $${values.length}`)
  }

  const resultConditions: string[] = []
  if (query.filter === 'zero') resultConditions.push('"orders1d" = 0 AND "adCost" > 0')
  if (query.filter === 'orders') resultConditions.push('"orders1d" >= 1')
  if (query.excludeRemoved) resultConditions.push('"removedAt" IS NULL')

  values.push(query.pageSize)
  const limitParam = `$${values.length}`
  values.push((query.page - 1) * query.pageSize)
  const offsetParam = `$${values.length}`

  const rows = await prisma.$queryRawUnsafe<KeywordRow[]>(
    `
      WITH aggregated AS (
        SELECT
          a.keyword,
          SUM(a."adCost") AS "adCost",
          SUM(a.impressions)::bigint AS impressions,
          SUM(a.clicks)::bigint AS clicks,
          SUM(a."orders1d")::bigint AS "orders1d",
          SUM(a."revenue1d") AS "revenue1d"
        FROM "AdRecord" a
        WHERE ${conditions.join(' AND ')}
        GROUP BY a.keyword
      ),
      enriched AS (
        SELECT aggregated.*, status."removedAt"
        FROM aggregated
        LEFT JOIN "KeywordStatus" status
          ON status."workspaceId" = $1
         AND status."campaignId" = $2
         AND status.keyword = aggregated.keyword
      )
      SELECT enriched.*, COUNT(*) OVER()::bigint AS total
      FROM enriched
      ${resultConditions.length > 0 ? `WHERE ${resultConditions.join(' AND ')}` : ''}
      ORDER BY ${SORT_SQL[query.sortBy]} ${query.sortOrder.toUpperCase()} NULLS LAST
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    ...values
  )

  const items = rows.map((row) => {
    const adCost = Number(row.adCost ?? 0)
    const impressions = Number(row.impressions ?? 0)
    const clicks = Number(row.clicks ?? 0)
    const orders1d = Number(row.orders1d ?? 0)
    const revenue1d = Number(row.revenue1d ?? 0)

    return {
      keyword: row.keyword,
      adCost,
      clicks,
      impressions,
      orders1d,
      revenue1d,
      ctr: calculateCTR(clicks, impressions),
      cvr: calculateCVR(orders1d, clicks),
      roas: calculateROAS(revenue1d, adCost),
      removedAt: row.removedAt?.toISOString().split('T')[0] ?? null,
    }
  })

  return NextResponse.json({
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: Number(rows[0]?.total ?? 0),
  })
}
