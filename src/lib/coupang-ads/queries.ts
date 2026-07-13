/**
 * coupang-ads Deck — 조회(read) 로직 단일 소스.
 * app/api/(dashboard|campaigns|collection|analysis)/* route와 MCP tool이
 * 동일한 함수를 공유하기 위해 각 route의 인라인 쿼리/집계 로직을 기계적으로 이동한 것.
 *
 * ⚠️ 규약:
 *  - 이 파일의 함수는 순수 read 시그니처다(단, collection/runs의 고착 RUNNING 정리 write는
 *    route 동작을 그대로 유지하기 위해 함께 이동했다 — route와 tool 경로가 동일하게 동작).
 *  - URLSearchParams·NextRequest·NextResponse를 다루지 않는다.
 *    파라미터는 이미 파싱된 타입 인자로 받고, route가 NextResponse.json에 넘기던 바로 그 객체를 반환한다.
 */
import { prisma } from '@/lib/prisma'
import { formatDateToYmdKst } from '@/lib/date-range'
import { cacheCoupangAdsData } from '@/lib/coupang-ads/cache'
import { calculateCTR, calculateCVR, calculateROAS } from '@/lib/metrics-calculator'
import type { KeywordQuery, KeywordSortKey } from '@/lib/coupang-ads/keyword-query'

// ─── ads_get_kpi ─────────────────────────────────────────────────────────────

// WoW(기간 대비) 증감율 계산 — 이전 값이 0이면 null
function calcWow(current: number, prev: number): number | null {
  if (prev === 0) return null
  return Math.round(((current - prev) / prev) * 1000) / 10
}

/** GET /api/dashboard/kpi 인라인 로직 이동 — 선택 기간 집계 KPI + 이전 동일 기간 대비 증감율. */
export async function queryKpi(workspaceId: string, opts: { startDate: string; endDate: string }) {
  const { startDate, endDate } = opts

  const startObj = new Date(startDate + 'T00:00:00+09:00')
  const endObj = new Date(endDate + 'T23:59:59+09:00')

  // 이전 동일 기간 계산 (현재 기간과 동일 일수만큼 이전)
  const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1
  const prevEndDate = new Date(Date.parse(startDate) - 86400000).toISOString().split('T')[0]
  const prevStartDate = new Date(Date.parse(startDate) - days * 86400000)
    .toISOString()
    .split('T')[0]
  const prevStartObj = new Date(prevStartDate + 'T00:00:00+09:00')
  const prevEndObj = new Date(prevEndDate + 'T23:59:59+09:00')

  // 현재 기간 집계
  const currentAgg = await prisma.adRecord.aggregate({
    where: {
      workspaceId,
      date: { gte: startObj, lte: endObj },
    },
    _sum: { adCost: true, revenue1d: true, orders1d: true, clicks: true, impressions: true },
  })

  // 이전 기간 집계
  const prevAgg = await prisma.adRecord.aggregate({
    where: {
      workspaceId,
      date: { gte: prevStartObj, lte: prevEndObj },
    },
    _sum: { adCost: true, revenue1d: true, orders1d: true, clicks: true, impressions: true },
  })

  // 현재 수치
  const adCost = Number(currentAgg._sum.adCost ?? 0)
  const revenue = Number(currentAgg._sum.revenue1d ?? 0)
  const orders = Number(currentAgg._sum.orders1d ?? 0)
  const clicks = Number(currentAgg._sum.clicks ?? 0)
  const impressions = Number(currentAgg._sum.impressions ?? 0)

  // 이전 수치
  const prevAdCost = Number(prevAgg._sum.adCost ?? 0)
  const prevRevenue = Number(prevAgg._sum.revenue1d ?? 0)
  const prevOrders = Number(prevAgg._sum.orders1d ?? 0)
  const prevClicks = Number(prevAgg._sum.clicks ?? 0)
  const prevImpressions = Number(prevAgg._sum.impressions ?? 0)

  // KPI 계산
  const roas = adCost > 0 ? (revenue / adCost) * 100 : null
  const prevRoas = prevAdCost > 0 ? (prevRevenue / prevAdCost) * 100 : null
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : null
  const prevCtr = prevImpressions > 0 ? (prevClicks / prevImpressions) * 100 : null
  const cvr = clicks > 0 ? (orders / clicks) * 100 : null
  const prevCvr = prevClicks > 0 ? (prevOrders / prevClicks) * 100 : null

  return {
    adCost,
    roas,
    revenue,
    ctr,
    cvr,
    prevAdCost,
    prevRoas,
    prevRevenue,
    prevCtr,
    prevCvr,
    wow: {
      adCost: calcWow(adCost, prevAdCost),
      roas: roas !== null && prevRoas !== null ? calcWow(roas, prevRoas) : null,
      revenue: calcWow(revenue, prevRevenue),
      ctr: ctr !== null && prevCtr !== null ? calcWow(ctr, prevCtr) : null,
      cvr: cvr !== null && prevCvr !== null ? calcWow(cvr, prevCvr) : null,
    },
  }
}

// ─── ads_list_campaigns ──────────────────────────────────────────────────────

/**
 * GET /api/campaigns 인라인 로직 이동 — 캠페인 목록(displayName 포함).
 * startDate·endDate 제공 시 캠페인별 기간 지표 + 이전 동일 기간 지표 enrich.
 */
export async function queryCampaigns(
  workspaceId: string,
  opts: { startDate?: string; endDate?: string } = {}
) {
  const { rows, metas, allTargets } = await cacheCoupangAdsData(
    'campaign-catalog',
    { workspaceId },
    async () => {
      // Prisma distinct는 모든 원본 행을 애플리케이션으로 가져오므로 DB DISTINCT ON을 사용한다.
      const [rows, metas, allTargets] = await Promise.all([
        prisma.$queryRaw<Array<{ campaignId: string; campaignName: string; adType: string }>>`
          SELECT DISTINCT ON ("campaignId", "adType")
            "campaignId", "campaignName", "adType"
          FROM "AdRecord"
          WHERE "workspaceId" = ${workspaceId}
          ORDER BY "campaignId" ASC, "adType" ASC, date DESC
        `,
        prisma.campaignMeta.findMany({
          where: { workspaceId },
          select: { campaignId: true, displayName: true, isCustomName: true },
        }),
        prisma.campaignTarget.findMany({
          where: {
            workspaceId,
            effectiveDate: { lte: new Date() },
          },
          orderBy: { effectiveDate: 'desc' },
          select: { campaignId: true, dailyBudget: true, targetRoas: true },
        }),
      ])
      return { rows, metas, allTargets }
    }
  )

  const metaMap = new Map(metas.map((m) => [m.campaignId, m]))

  // campaignId별 그룹화
  const campaignMap = new Map<
    string,
    { id: string; name: string; displayName: string; isCustomName: boolean; adTypes: string[] }
  >()
  for (const row of rows) {
    if (!campaignMap.has(row.campaignId)) {
      const meta = metaMap.get(row.campaignId)
      campaignMap.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaignName,
        displayName: meta?.displayName ?? row.campaignName,
        isCustomName: meta?.isCustomName ?? false,
        adTypes: [],
      })
    }
    const campaign = campaignMap.get(row.campaignId)!
    if (!campaign.adTypes.includes(row.adType)) {
      campaign.adTypes.push(row.adType)
    }
  }

  const campaigns = Array.from(campaignMap.values())

  // 각 캠페인의 현재 유효한 CampaignTarget (effectiveDate <= now, 가장 최근 1건)
  const targetMap = new Map<string, { dailyBudget: number | null; targetRoas: number | null }>()
  for (const t of allTargets) {
    if (!targetMap.has(t.campaignId)) {
      targetMap.set(t.campaignId, { dailyBudget: t.dailyBudget, targetRoas: t.targetRoas })
    }
  }

  const { startDate, endDate } = opts

  if (startDate && endDate) {
    const startObj = new Date(startDate + 'T00:00:00+09:00')
    const endObj = new Date(endDate + 'T23:59:59+09:00')

    // 이전 동일 기간 계산 (현재 기간과 동일 일수)
    const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86400000) + 1
    const prevEndDate = new Date(Date.parse(startDate) - 86400000).toISOString().split('T')[0]
    const prevStartDate = new Date(Date.parse(startDate) - days * 86400000)
      .toISOString()
      .split('T')[0]
    const prevStartObj = new Date(prevStartDate + 'T00:00:00+09:00')
    const prevEndObj = new Date(prevEndDate + 'T23:59:59+09:00')

    // 캠페인별 전체 데이터 기간 (minDate, maxDate)
    const dateRanges = await prisma.adRecord.groupBy({
      by: ['campaignId'],
      where: { workspaceId },
      _min: { date: true },
      _max: { date: true },
    })
    const dateRangeMap = new Map(
      (
        dateRanges as Array<{
          campaignId: string
          _min: { date: unknown }
          _max: { date: unknown }
        }>
      ).map((r) => [
        r.campaignId,
        {
          minDate: r._min.date ? formatDateToYmdKst(r._min.date as Date) : null,
          maxDate: r._max.date ? formatDateToYmdKst(r._max.date as Date) : null,
        },
      ])
    )

    // 현재 기간 캠페인별 집계
    const currentAgg = await prisma.adRecord.groupBy({
      by: ['campaignId'],
      where: { workspaceId, date: { gte: startObj, lte: endObj } },
      _sum: { adCost: true, revenue1d: true },
    })

    // 이전 기간 캠페인별 집계
    const prevAgg = await prisma.adRecord.groupBy({
      by: ['campaignId'],
      where: { workspaceId, date: { gte: prevStartObj, lte: prevEndObj } },
      _sum: { adCost: true, revenue1d: true },
    })

    type AggRow = { campaignId: string; _sum: { adCost: unknown; revenue1d: unknown } }
    const currentMap = new Map((currentAgg as AggRow[]).map((a) => [a.campaignId, a]))
    const prevMap = new Map((prevAgg as AggRow[]).map((a) => [a.campaignId, a]))

    const enriched = campaigns.map((c) => {
      const curr = currentMap.get(c.id)
      const prev = prevMap.get(c.id)

      const totalAdCost = Number(curr?._sum.adCost ?? 0)
      const totalRevenue = Number(curr?._sum.revenue1d ?? 0)
      const avgRoas = totalAdCost > 0 ? (totalRevenue / totalAdCost) * 100 : null

      const prevAdCost = Number(prev?._sum.adCost ?? 0)
      const prevRevenue = Number(prev?._sum.revenue1d ?? 0)
      const prevRoas = prevAdCost > 0 ? (prevRevenue / prevAdCost) * 100 : null

      const ct = targetMap.get(c.id) ?? null
      const dr = dateRangeMap.get(c.id)
      return {
        ...c,
        metrics: { totalAdCost, totalRevenue, avgRoas },
        prevMetrics: prev
          ? { totalAdCost: prevAdCost, totalRevenue: prevRevenue, avgRoas: prevRoas }
          : null,
        currentTarget: ct,
        minDate: dr?.minDate ?? null,
        maxDate: dr?.maxDate ?? null,
      }
    })

    return enriched
  }

  // 기간 파라미터 없을 때도 minDate/maxDate 포함
  const allDateRanges = await prisma.adRecord.groupBy({
    by: ['campaignId'],
    where: { workspaceId },
    _min: { date: true },
    _max: { date: true },
  })
  const allDateRangeMap = new Map(
    (
      allDateRanges as Array<{
        campaignId: string
        _min: { date: unknown }
        _max: { date: unknown }
      }>
    ).map((r) => [
      r.campaignId,
      {
        minDate: r._min.date ? formatDateToYmdKst(r._min.date as Date) : null,
        maxDate: r._max.date ? formatDateToYmdKst(r._max.date as Date) : null,
      },
    ])
  )

  return campaigns.map((c) => {
    const dr = allDateRangeMap.get(c.id)
    return {
      ...c,
      currentTarget: targetMap.get(c.id) ?? null,
      minDate: dr?.minDate ?? null,
      maxDate: dr?.maxDate ?? null,
    }
  })
}

// ─── ads_get_inefficient_keywords ────────────────────────────────────────────

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

/**
 * GET /api/campaigns/[campaignId]/inefficient-keywords 인라인 로직 이동 —
 * 캠페인 키워드 집계(기본 전체, query.filter로 비효율/주문 필터).
 * URLSearchParams 파싱(parseKeywordQuery)은 route/tool 쪽에서 수행하고 KeywordQuery로 넘긴다.
 */
export async function queryInefficientKeywords(
  workspaceId: string,
  campaignId: string,
  opts: { from?: string | null; to?: string | null; adType?: string | null; query: KeywordQuery }
) {
  const { from, to, adType, query } = opts

  // 날짜 필터 조건 구성
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (from) dateFilter.gte = new Date(from + 'T00:00:00+09:00')
  if (to) dateFilter.lte = new Date(to + 'T23:59:59+09:00')

  const conditions = ['a."workspaceId" = $1', 'a."campaignId" = $2', 'a.keyword IS NOT NULL']
  const values: unknown[] = [workspaceId, campaignId]

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

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: Number(rows[0]?.total ?? 0),
  }
}

// ─── ads_get_collection_status ───────────────────────────────────────────────

// 10분 이상 RUNNING 상태면 타임아웃 처리
const STALE_THRESHOLD_MS = 10 * 60 * 1000

/**
 * GET /api/collection/runs 인라인 로직 이동 — 수집 실행 이력 조회.
 * 주의: 고착된 RUNNING 상태 자동 정리(updateMany write)를 포함해 route와 동일하게 동작한다.
 */
export async function queryCollectionRuns(
  workspaceId: string,
  opts: { limit?: number; cursor?: string | null } = {}
) {
  const limit = Math.min(opts.limit ?? 20, 100)
  const cursor = opts.cursor ?? null

  // 고착된 RUNNING 상태 자동 정리
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS)
  await prisma.collectionRun.updateMany({
    where: {
      workspaceId,
      status: { in: ['RUNNING', 'DOWNLOADING', 'PARSING'] },
      startedAt: { lt: staleThreshold },
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error: '타임아웃: 10분 이상 응답 없음',
    },
  })

  const runs = await prisma.collectionRun.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  // 다음 페이지 존재 여부 확인
  const hasMore = runs.length > limit
  if (hasMore) runs.pop()

  // uploadId가 있는 run에 대해 ReportUpload 정보 조회
  const uploadIds = runs.map((r) => r.uploadId).filter(Boolean) as string[]
  const uploads =
    uploadIds.length > 0
      ? await prisma.reportUpload.findMany({
          where: { id: { in: uploadIds } },
          select: {
            id: true,
            fileName: true,
            periodStart: true,
            periodEnd: true,
            totalRows: true,
            insertedRows: true,
            duplicateRows: true,
          },
        })
      : []
  const uploadMap = new Map(uploads.map((u) => [u.id, u]))

  const runsWithUpload = runs.map((r) => ({
    ...r,
    upload: r.uploadId ? (uploadMap.get(r.uploadId) ?? null) : null,
  }))

  return {
    runs: runsWithUpload,
    nextCursor: hasMore ? runs[runs.length - 1].id : null,
  }
}

// ─── ads_get_latest_report ───────────────────────────────────────────────────

/** GET /api/analysis/reports 인라인 로직 이동 — 분석 리포트 목록(최신 20건). */
export async function queryReports(workspaceId: string) {
  const reports = await prisma.analysisReport.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      reportType: true,
      summary: true,
      suggestions: true,
      metadata: true,
      status: true,
      triggeredBy: true,
      createdAt: true,
    },
  })

  return { reports }
}
