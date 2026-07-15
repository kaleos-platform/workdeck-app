import { z } from 'zod'
import { resolveMcpWorkspace } from '@/lib/mcp/context'
import {
  queryKpi,
  queryCampaigns,
  queryInefficientKeywords,
  queryCollectionRuns,
  queryReports,
} from '@/lib/coupang-ads/queries'
import { getCachedCampaignOverview } from '@/lib/coupang-ads/campaign-overview'
import { parseKeywordQuery } from '@/lib/coupang-ads/keyword-query'
import type { ToolDefinition } from './types'

/**
 * coupang-ads Deck 조회(read) tool 6종.
 * coupang-ads는 Workspace 스코프(레거시)라 finance/seller-hub와 달리 resolveMcpWorkspace를 게이트로 쓴다.
 * resolveMcpWorkspace는 웹 resolveWorkspace()와 동일하게: Space 없음=관용, deck 비활성=throw.
 * route와 동일한 queries.ts 함수(또는 campaign-overview lib)를 공유한다.
 */

/** GET /api/dashboard/kpi 대응 — 선택 기간 집계 KPI + 이전 동일 기간 대비 증감율. */
const adsGetKpiTool: ToolDefinition = {
  name: 'ads_get_kpi',
  description:
    '지정 기간(startDate~endDate)의 쿠팡 광고 KPI를 반환합니다. 광고비·매출·ROAS·CTR·CVR과 직전 동일 기간 대비 증감율(wow)을 포함합니다. startDate·endDate는 필수(YYYY-MM-DD)입니다.',
  inputSchema: {
    startDate: z.string(),
    endDate: z.string(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { workspace } = await resolveMcpWorkspace(ctx.userId)
    return queryKpi(workspace.id, {
      startDate: params.startDate as string,
      endDate: params.endDate as string,
    })
  },
}

/** GET /api/campaigns 대응 — 캠페인 목록(기간 지표 옵션 enrich). */
const adsListCampaignsTool: ToolDefinition = {
  name: 'ads_list_campaigns',
  description:
    '워크스페이스의 캠페인 목록을 반환합니다. 각 캠페인의 표시명·광고유형·목표(예산/ROAS)·데이터 기간(minDate/maxDate)을 포함합니다. startDate·endDate(선택, YYYY-MM-DD) 제공 시 캠페인별 기간 지표(광고비/매출/ROAS)와 직전 동일 기간 지표를 추가로 포함합니다. 캠페인을 찾을 때(이름→ID) 사용하세요. limit(기본 20)으로 반환 건수를 제한하며 total(전체 건수)을 함께 반환합니다.',
  inputSchema: {
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    limit: z.number().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { workspace } = await resolveMcpWorkspace(ctx.userId)
    const all = await queryCampaigns(workspace.id, {
      startDate: params.startDate as string | undefined,
      endDate: params.endDate as string | undefined,
    })
    const limit = (params.limit as number | undefined) ?? 20
    return { campaigns: all.slice(0, limit), total: all.length }
  },
}

/** GET /api/campaigns/[campaignId]/overview 대응 — 캠페인 단건 상세. */
const adsGetCampaignTool: ToolDefinition = {
  name: 'ads_get_campaign',
  description:
    'campaignId로 단일 캠페인의 상세를 반환합니다(지표 시계열·직전 기간 시계열·목표·목표대비 요약·메모). 캠페인을 찾으려면(이름 검색) ads_list_campaigns를 먼저 사용하세요. campaignId·from·to는 필수(YYYY-MM-DD)이고 adType은 선택(기본 all)입니다.',
  inputSchema: {
    campaignId: z.string(),
    from: z.string(),
    to: z.string(),
    adType: z.string().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { workspace } = await resolveMcpWorkspace(ctx.userId)
    return getCachedCampaignOverview({
      workspaceId: workspace.id,
      campaignId: params.campaignId as string,
      from: params.from as string,
      to: params.to as string,
      adType: (params.adType as string | undefined) ?? 'all',
    })
  },
}

/** GET /api/campaigns/[campaignId]/inefficient-keywords 대응 — 특정 캠페인 키워드 집계. */
const adsGetInefficientKeywordsTool: ToolDefinition = {
  name: 'ads_get_inefficient_keywords',
  description:
    '특정 캠페인(campaignId 필수)의 키워드 집계를 반환합니다. filter="zero"로 지출은 있으나 주문 0인 비효율 키워드, "orders"로 주문 발생 키워드를 조회합니다. from/to(YYYY-MM-DD)·adType으로 필터하고 page/pageSize(기본 50)로 페이지네이션하며 total을 함께 반환합니다.',
  inputSchema: {
    campaignId: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
    adType: z.string().optional(),
    filter: z.enum(['all', 'zero', 'orders']).optional(),
    search: z.string().optional(),
    excludeRemoved: z.boolean().optional(),
    sortBy: z.enum(['keyword', 'adCost', 'ctr', 'cvr', 'roas', 'orders1d', 'revenue1d']).optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    page: z.number().optional(),
    pageSize: z.number().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { workspace } = await resolveMcpWorkspace(ctx.userId)
    // route는 parseKeywordQuery(URLSearchParams)로 파싱하지만, tool은 params를
    // URLSearchParams로 변환해 동일 파서를 재사용한다(기본값·클램프 규칙 공유).
    const sp = new URLSearchParams()
    if (params.filter !== undefined) sp.set('filter', String(params.filter))
    if (params.search !== undefined) sp.set('search', String(params.search))
    if (params.excludeRemoved !== undefined) sp.set('excludeRemoved', String(params.excludeRemoved))
    if (params.sortBy !== undefined) sp.set('sortBy', String(params.sortBy))
    if (params.sortOrder !== undefined) sp.set('sortOrder', String(params.sortOrder))
    if (params.page !== undefined) sp.set('page', String(params.page))
    if (params.pageSize !== undefined) sp.set('pageSize', String(params.pageSize))
    const query = parseKeywordQuery(sp)

    return queryInefficientKeywords(workspace.id, params.campaignId as string, {
      from: params.from as string | undefined,
      to: params.to as string | undefined,
      adType: params.adType as string | undefined,
      query,
    })
  },
}

/** GET /api/collection/runs 대응 — 수집 실행 이력/상태. */
const adsGetCollectionStatusTool: ToolDefinition = {
  name: 'ads_get_collection_status',
  description:
    '쿠팡 데이터 수집 실행 이력과 상태를 최신순으로 반환합니다. 각 실행의 상태(PENDING/RUNNING/SUCCESS/FAILED 등)·트리거·업로드 정보를 포함합니다. limit(기본 20, 최대 100)으로 건수를 제한하며 다음 페이지 커서(nextCursor)를 함께 반환합니다.',
  inputSchema: {
    limit: z.number().optional(),
    cursor: z.string().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { workspace } = await resolveMcpWorkspace(ctx.userId)
    return queryCollectionRuns(workspace.id, {
      limit: params.limit as number | undefined,
      cursor: params.cursor as string | undefined,
    })
  },
}

/** GET /api/analysis/reports 대응 — 분석 리포트 목록(최신순). */
const adsGetLatestReportTool: ToolDefinition = {
  name: 'ads_get_latest_report',
  description:
    '쿠팡 광고 분석 리포트 목록을 최신순으로 반환합니다(요약·제안·기간·상태 포함). 기본 최신 20건을 반환하며, 최신 리포트는 목록의 첫 번째 항목입니다. limit(기본 20)으로 반환 건수를 제한할 수 있습니다.',
  inputSchema: {
    limit: z.number().optional(),
  },
  mode: 'read',
  async execute(ctx, params) {
    const { workspace } = await resolveMcpWorkspace(ctx.userId)
    const { reports } = await queryReports(workspace.id)
    const limit = (params.limit as number | undefined) ?? 20
    return { reports: reports.slice(0, limit) }
  },
}

export const coupangAdsTools: ToolDefinition[] = [
  adsGetKpiTool,
  adsListCampaignsTool,
  adsGetCampaignTool,
  adsGetInefficientKeywordsTool,
  adsGetCollectionStatusTool,
  adsGetLatestReportTool,
]
