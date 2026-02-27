import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import { calculateCTR } from '@/lib/metrics-calculator'

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
      ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
      ...(adType && adType !== 'all' && { adType }),
    },
    _sum: {
      adCost: true,
      impressions: true,
      clicks: true,
      orders1d: true,
      revenue1d: true,
    },
    // 기간 내 총 주문수가 0이고 광고비가 있는 키워드만 추출
    having: {
      orders1d: { _sum: { equals: 0 } },
      adCost: { _sum: { gt: 0 } },
    },
    orderBy: {
      _sum: { adCost: 'desc' },
    },
  })

  const keywordList = groups
    .map((g: { keyword: string | null }) => g.keyword)
    .filter((k): k is string => k !== null)

  // 키워드 제거 상태 조회
  const keywordStatuses = await prisma.keywordStatus.findMany({
    where: { workspaceId: workspace.id, campaignId, keyword: { in: keywordList } },
    select: { keyword: true, removedAt: true },
  })

  const removedAtMap = new Map(
    keywordStatuses.map((s: { keyword: string; removedAt: Date | null }) => [
      s.keyword,
      s.removedAt ? s.removedAt.toISOString().split('T')[0] : null,
    ])
  )

  const items = groups.map(
    (g: {
      keyword: string | null
      _sum: {
        adCost: unknown
        impressions: unknown
        clicks: unknown
        orders1d: unknown
        revenue1d: unknown
      }
    }) => {
      const adCost = Number(g._sum.adCost ?? 0)
      const impressions = Number(g._sum.impressions ?? 0)
      const clicks = Number(g._sum.clicks ?? 0)
      // orders1d는 having 조건(=0)으로 필터됐으므로 항상 0
      const orders1d = Number(g._sum.orders1d ?? 0)
      const keyword = g.keyword!

      return {
        keyword,
        adCost,
        clicks,
        impressions,
        orders1d,
        ctr: calculateCTR(clicks, impressions),
        removedAt: removedAtMap.get(keyword) ?? null,
      }
    }
  )

  return NextResponse.json({ items })
}
