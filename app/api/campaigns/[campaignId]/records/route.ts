import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'
import { calculateCTR, calculateCVR, calculateROAS } from '@/lib/metrics-calculator'

// 허용된 정렬 컬럼
const ALLOWED_SORT_KEYS = ['date', 'adCost', 'clicks', 'impressions', 'roas14d'] as const
type SortKey = (typeof ALLOWED_SORT_KEYS)[number]

// 상품명에서 옵션명 파싱 (JSON 형식 '{"구성":"5P"},{"사이즈":"M"}' 패턴 추출)
function parseOptionName(productName: string | null): string | null {
  if (!productName) return null
  const matches = productName.matchAll(/\{"(?:구성|사이즈)":"([^"]+)"\}/g)
  const values = [...new Set([...matches].map((m) => m[1].trim()))]
  return values.length > 0 ? values.join('/') : null
}

// GET /api/campaigns/[campaignId]/records — 광고 데이터 목록 (페이지네이션 + 정렬)
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
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25') || 25))
  const rawSortBy = searchParams.get('sortBy') ?? 'date'
  const sortKey: SortKey = ALLOWED_SORT_KEYS.includes(rawSortBy as SortKey)
    ? (rawSortBy as SortKey)
    : 'date'
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc'

  // 날짜 필터 조건 구성
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
  if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

  const where = {
    workspaceId: workspace.id,
    campaignId,
    ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
    ...(adType && adType !== 'all' && { adType }),
  }

  const [total, items] = await prisma.$transaction([
    prisma.adRecord.count({ where }),
    prisma.adRecord.findMany({
      where,
      orderBy: { [sortKey]: sortOrder },
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
        orders14d: true,
        revenue14d: true,
        roas14d: true,
      },
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

    return {
      ...r,
      date: (r.date as Date).toISOString().split('T')[0],
      adCost,
      revenue1d,
      roas1d: Number(r.roas1d),
      revenue14d: Number(r.revenue14d),
      roas14d: Number(r.roas14d),
      // F008: 계산 지표 통일
      ctr: calculateCTR(clicks, impressions),
      cvr: calculateCVR(orders1d, clicks),
      roas: calculateROAS(revenue1d, adCost),
      // 서버사이드 상품명/옵션명 파싱
      parsedProductName: productName ? productName.split(',')[0].trim() : null,
      parsedOptionName: parseOptionName(productName),
    }
  })

  return NextResponse.json({ items: normalized, page, pageSize, total })
}
