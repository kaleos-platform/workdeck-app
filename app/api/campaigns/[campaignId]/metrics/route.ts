import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/metrics — 날짜별 지표 시계열
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
  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
  if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

  const series = await prisma.adRecord.groupBy({
    by: ['date'],
    where: {
      workspaceId: workspace.id,
      campaignId,
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
      ...(adType && adType !== 'all' && { adType }),
    },
    _sum: {
      adCost: true,
      clicks: true,
      impressions: true,
    },
    _avg: {
      roas14d: true,
    },
    orderBy: { date: 'asc' },
  })

  // 날짜 포맷 + Decimal → Number 변환
  const result = series.map(
    (item: {
      date: Date
      _sum: { adCost: unknown; clicks: unknown; impressions: unknown }
      _avg: { roas14d: unknown }
    }) => ({
      date: item.date.toISOString().split('T')[0],
      adCost: Number(item._sum.adCost ?? 0),
      clicks: Number(item._sum.clicks ?? 0),
      impressions: Number(item._sum.impressions ?? 0),
      roas14d: Number(item._avg.roas14d ?? 0),
    })
  )

  return NextResponse.json({ series: result })
}
