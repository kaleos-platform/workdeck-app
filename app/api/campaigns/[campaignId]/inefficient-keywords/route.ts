import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/inefficient-keywords
// 광고비 지출 & 주문수(1일) = 0인 비효율 키워드 집계
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

  // 날짜 필터 조건 구성
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
  if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

  const groups = await prisma.adRecord.groupBy({
    by: ['keyword'],
    where: {
      workspaceId: workspace.id,
      campaignId,
      keyword: { not: null },
      orders1d: 0,
      adCost: { gt: 0 },
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
      ...(adType && adType !== 'all' && { adType }),
    },
    _sum: {
      adCost: true,
      impressions: true,
      clicks: true,
    },
    orderBy: {
      _sum: { adCost: 'desc' },
    },
  })

  const items = groups.map(
    (g: {
      keyword: string | null
      _sum: { adCost: unknown; impressions: unknown; clicks: unknown }
    }) => ({
      keyword: g.keyword!,
      adCost: Number(g._sum.adCost ?? 0),
      impressions: Number(g._sum.impressions ?? 0),
      clicks: Number(g._sum.clicks ?? 0),
      orders1d: 0,
    })
  )

  return NextResponse.json({ items })
}
