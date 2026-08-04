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
import { parseConditions, buildRecordWhereSql } from '@/lib/coupang-ads/metric-filter'

// findMany select와 raw SELECT가 반환하는 공통 행 형태 (normalize 입력)
type RawAdRow = {
  id: string
  date: Date
  adType: string
  campaignId: string
  campaignName: string
  adGroup: string | null
  placement: string | null
  productName: string | null
  optionId: string | null
  keyword: string | null
  impressions: number | bigint
  clicks: number | bigint
  adCost: unknown
  orders1d: number | bigint
  revenue1d: unknown
  roas1d: unknown
  material: string | null
  engagements: number | null
}

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

  // 커스텀 지표 필터 (광고 데이터 탭) — 있으면 행별 raw SQL 경로, 없으면 findMany
  const conditions = parseConditions(searchParams.get('conditions'))

  const where = {
    workspaceId: workspace.id,
    campaignId,
    ...(Object.keys(dateFilter).length > 0 && { date: dateFilter }),
    ...(adType && adType !== 'all' && { adType }),
    ...(placement && placement !== 'all' && { placement }),
  }

  const placementConditions = ['"workspaceId" = $1', '"campaignId" = $2', 'placement IS NOT NULL']
  const placementValues: unknown[] = [workspace.id, campaignId]
  if (dateFilter.gte) {
    placementValues.push(dateFilter.gte)
    placementConditions.push(`date >= $${placementValues.length}`)
  }
  if (dateFilter.lte) {
    placementValues.push(dateFilter.lte)
    placementConditions.push(`date <= $${placementValues.length}`)
  }
  if (adType && adType !== 'all') {
    placementValues.push(adType)
    placementConditions.push(`"adType" = $${placementValues.length}`)
  }

  // placement 드롭다운 목록은 지표 조건과 무관 (항상 동일 쿼리)
  const placementPromise = prisma.$queryRawUnsafe<Array<{ placement: string | null }>>(
    `
      SELECT DISTINCT placement
      FROM "AdRecord"
      WHERE ${placementConditions.join(' AND ')}
      ORDER BY placement ASC
    `,
    ...placementValues
  )

  const ROW_COLUMNS = `id, date, "adType", "campaignId", "campaignName", "adGroup", placement,
    "productName", "optionId", keyword, impressions, clicks, "adCost", "orders1d",
    "revenue1d", "roas1d", material, engagements`

  let total: number
  let items: RawAdRow[]

  if (conditions.length > 0) {
    // 행별 조건 → 원본 컬럼 WHERE. date DESC, id ASC 로 OFFSET 페이지네이션 안정화.
    const values: unknown[] = [workspace.id, campaignId]
    const rowConds = ['"workspaceId" = $1', '"campaignId" = $2']
    if (dateFilter.gte) {
      values.push(dateFilter.gte)
      rowConds.push(`date >= $${values.length}`)
    }
    if (dateFilter.lte) {
      values.push(dateFilter.lte)
      rowConds.push(`date <= $${values.length}`)
    }
    if (adType && adType !== 'all') {
      values.push(adType)
      rowConds.push(`"adType" = $${values.length}`)
    }
    if (placement && placement !== 'all') {
      values.push(placement)
      rowConds.push(`placement = $${values.length}`)
    }
    const metric = buildRecordWhereSql(conditions, values.length + 1)
    if (metric.clause) {
      rowConds.push(metric.clause)
      values.push(...metric.values)
    }
    const whereSql = rowConds.join(' AND ')

    const countRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "AdRecord" WHERE ${whereSql}`,
      ...values
    )
    total = Number(countRows[0]?.count ?? 0)

    values.push(pageSize)
    const limitParam = `$${values.length}`
    values.push((page - 1) * pageSize)
    const offsetParam = `$${values.length}`

    items = await prisma.$queryRawUnsafe<RawAdRow[]>(
      `
        SELECT ${ROW_COLUMNS}
        FROM "AdRecord"
        WHERE ${whereSql}
        ORDER BY date DESC, id ASC
        LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      ...values
    )
  } else {
    ;[total, items] = await Promise.all([
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
      }) as unknown as Promise<RawAdRow[]>,
    ])
  }

  const placementRows = await placementPromise

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
