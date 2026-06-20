import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import { calculateCTR, calculateCVR, calculateROAS } from '@/lib/metrics-calculator'
import { parseOptionName, parsePureProductName } from '@/lib/product-name-parser'
import { cacheCoupangAdsData } from '@/lib/coupang-ads/cache'

// GET /api/campaigns/[campaignId]/product-analysis
// 캠페인 상품별 집계 데이터 반환
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

  const data = await cacheCoupangAdsData(
    'product-analysis',
    {
      workspaceId: workspace.id,
      campaignId,
      from: from ?? '',
      to: to ?? '',
      adType: adType ?? 'all',
    },
    async () => {
      // 상품별 집계
      const groups = await prisma.adRecord.groupBy({
        by: ['productName', 'optionId'],
        where: {
          workspaceId: workspace.id,
          campaignId,
          productName: { not: null },
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
        orderBy: {
          _sum: { adCost: 'desc' },
        },
      })

      // 전체 광고비 합산
      const totalAdCost = groups.reduce(
        (sum: number, g: { _sum: { adCost: unknown } }) => sum + Number(g._sum.adCost ?? 0),
        0
      )

      // 상품 제거 상태 조회
      const statuses = await prisma.productStatus.findMany({
        where: { workspaceId: workspace.id, campaignId },
        select: { productName: true, optionId: true, removedAt: true },
      })

      // (productName, optionId) → removedAt 맵
      const statusMap = new Map(
        statuses.map((s: { productName: string; optionId: string; removedAt: Date | null }) => [
          `${s.productName}|${s.optionId}`,
          s.removedAt ? s.removedAt.toISOString().split('T')[0] : null,
        ])
      )

      const items = groups.map(
        (g: {
          productName: string | null
          optionId: string | null
          _sum: {
            adCost: unknown
            impressions: unknown
            clicks: unknown
            orders1d: unknown
            revenue1d: unknown
          }
        }) => {
          const productName = g.productName ?? ''
          const optionId = g.optionId ?? null
          const adCost = Number(g._sum.adCost ?? 0)
          const impressions = Number(g._sum.impressions ?? 0)
          const clicks = Number(g._sum.clicks ?? 0)
          const orders1d = Number(g._sum.orders1d ?? 0)
          const revenue1d = Number(g._sum.revenue1d ?? 0)

          // ProductStatus는 optionId null → "" 로 정규화됨
          const statusKey = `${productName}|${optionId ?? ''}`

          return {
            productName,
            parsedProductName: parsePureProductName(productName),
            optionName: parseOptionName(productName),
            optionId,
            adCost,
            adCostShare: totalAdCost > 0 ? Math.round((adCost / totalAdCost) * 10000) / 100 : 0,
            impressions,
            clicks,
            ctr: calculateCTR(clicks, impressions),
            cvr: calculateCVR(orders1d, clicks),
            roas: calculateROAS(revenue1d, adCost),
            revenue1d,
            orders1d,
            removedAt: statusMap.get(statusKey) ?? null,
          }
        }
      )

      return { items, totalAdCost }
    }
  )

  return NextResponse.json(data)
}
