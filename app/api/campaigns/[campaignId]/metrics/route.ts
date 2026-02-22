import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import {
  calculateCTR,
  calculateCVR,
  calculateROAS,
  calculateEngagementRate,
} from '@/lib/metrics-calculator'

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
      orders1d: true,
      revenue1d: true,
      engagements: true,
    },
    orderBy: { date: 'asc' },
  })

  // 날짜 포맷 + Decimal → Number 변환 + CTR/CVR/ROAS 계산
  const result = series.map(
    (item: {
      date: Date
      _sum: {
        adCost: unknown
        clicks: unknown
        impressions: unknown
        orders1d: unknown
        revenue1d: unknown
        engagements: unknown
      }
    }) => {
      const adCost = Number(item._sum.adCost ?? 0)
      const clicks = Number(item._sum.clicks ?? 0)
      const impressions = Number(item._sum.impressions ?? 0)
      const orders1d = Number(item._sum.orders1d ?? 0)
      const revenue1d = Number(item._sum.revenue1d ?? 0)
      const engagements = Number(item._sum.engagements ?? 0)

      return {
        date: item.date.toISOString().split('T')[0],
        adCost,
        totalRevenue: revenue1d,
        impressions,
        engagements,
        ctr: calculateCTR(clicks, impressions),
        cvr: calculateCVR(orders1d, clicks),
        roas: calculateROAS(revenue1d, adCost),
        engagementRate: calculateEngagementRate(engagements, impressions),
      }
    }
  )

  return NextResponse.json({ series: result })
}
