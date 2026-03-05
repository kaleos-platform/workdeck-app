import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import {
  calculateCTR,
  calculateCVR,
  calculateROAS,
  calculateEngagementRate,
} from '@/lib/metrics-calculator'
import { formatDateToYmdKst } from '@/lib/date-range'
import { parseOptionName, parsePureProductName } from '@/lib/product-name-parser'

// GET /api/campaigns/[campaignId]/records — 광고 데이터 목록 (페이지네이션)
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
  const placement = searchParams.get('placement')
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25') || 25))

  // 날짜 필터 조건 구성
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
  if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

  const where = {
    workspaceId: workspace.id,
    campaignId,
    ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
    ...(adType && adType !== 'all' && { adType }),
    ...(placement && placement !== 'all' && { placement }),
  }

  const placementWhere = {
    workspaceId: workspace.id,
    campaignId,
    ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
    ...(adType && adType !== 'all' && { adType }),
  }

  const [total, items, placementRows] = await prisma.$transaction([
    prisma.adRecord.count({ where }),
    prisma.adRecord.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        date: true,
        adType: true,
        campaignId: true,
        campaignName: true,
        adGroup: true,
        placement: true,
        productName: true,
        optionId: true,
        keyword: true,
        impressions: true,
        clicks: true,
        adCost: true,
        orders1d: true,
        revenue1d: true,
        roas1d: true,
        material: true,
        engagements: true,
      },
    }),
    prisma.adRecord.findMany({
      where: placementWhere,
      select: { placement: true },
      distinct: ['placement'],
      orderBy: { placement: 'asc' },
    }),
  ])

  // Decimal → Number 변환, 날짜 포맷, CTR/CVR/ROAS 계산 (F008 기준 통일)
  const normalized = items.map((r) => {
    const adCost = Number(r.adCost)
    const clicks = Number(r.clicks)
    const impressions = Number(r.impressions)
    const orders1d = Number(r.orders1d)
    const revenue1d = Number(r.revenue1d)
    const productName = r.productName
    const engagements = r.engagements ?? 0

    return {
      ...r,
      date: formatDateToYmdKst(r.date as Date),
      adCost,
      revenue1d,
      roas1d: Number(r.roas1d),
      // F008: 계산 지표 통일
      ctr: calculateCTR(clicks, impressions),
      cvr: calculateCVR(orders1d, clicks),
      roas: calculateROAS(revenue1d, adCost),
      engagementRate: calculateEngagementRate(engagements, impressions),
      // 서버사이드 상품명/옵션명 파싱
      parsedProductName: productName ? parsePureProductName(productName) : null,
      parsedOptionName: parseOptionName(productName),
    }
  })

  const placements = placementRows
    .map((row) => row.placement)
    .filter((value): value is string => Boolean(value))

  return NextResponse.json({ items: normalized, page, pageSize, total, placements })
}
