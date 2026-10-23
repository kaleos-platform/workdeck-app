import { z } from 'zod'
import {
  assertDownloadUrl,
  loadNaverCred,
  naverRequest,
  parseTsv,
  resolveCustomer,
  withCredError,
} from '@/lib/agent/integrations/naver-searchad'
import { ToolUserError } from './errors'
import type { ToolDefinition } from './types'

/**
 * 네이버 검색광고 조회 도구 — 변경 도구는 두지 않는다(naver:read 만).
 * 광고 계정은 도구 입력의 customerId 가 아니라 Space 자격증명 config.customers 의 브랜드 매핑으로만 고른다.
 * 쇼핑 ADVoost(GFA_PMAX)·성과형 디스플레이는 검색광고 API 범위 밖이다.
 */
const brand = z
  .string()
  .optional()
  .describe('브랜드 키(Space 네이버 검색광고 자격증명의 customers 키). 없으면 기본 브랜드')

const DAY = /^\d{4}-\d{2}-\d{2}$/
// 형식뿐 아니라 실제 달력 날짜인지 확인한다(2026-13-45 같은 값이 기간 상한 검사를 NaN 으로 통과하지 않게).
const day = z
  .string()
  .regex(DAY)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s, {
    message: '존재하지 않는 날짜입니다',
  })
const MAX_RANGE_DAYS = 92
const STAT_FIELDS = [
  'impCnt',
  'clkCnt',
  'salesAmt',
  'ctr',
  'cpc',
  'avgRnk',
  'ccnt',
  'crto',
  'convAmt',
  'ror',
  'cpConv',
  'viewCnt',
  'purchaseCcnt',
  'purchaseConvAmt',
  'purchaseRor',
] as const
const DEFAULT_FIELDS = [
  'impCnt',
  'clkCnt',
  'salesAmt',
  'ccnt',
  'convAmt',
  'purchaseCcnt',
  'purchaseConvAmt',
]
const REPORT_TYPES = [
  'AD',
  'AD_DETAIL',
  'AD_CONVERSION',
  'AD_CONVERSION_DETAIL',
  'EXPKEYWORD',
  'SHOPPINGKEYWORD_DETAIL',
  'SHOPPINGKEYWORD_CONVERSION_DETAIL',
  'SHOPPINGBRANDPRODUCT',
  'SHOPPINGBRANDPRODUCT_CONVERSION',
] as const
const REPORT_PENDING = new Set(['REGIST', 'RUNNING', 'WAITING', 'AGGREGATING'])
const REPORT_POLL_MS = 3000
const REPORT_POLL_TRIES = 5
// MCP maxDuration(60초) 안에 report_job_id 를 돌려주도록 보고서 도구 전체에 마감시간을 둔다.
const REPORT_DEADLINE_MS = 45_000
const REQUEST_TIMEOUT_MS = 20_000

const listCustomers: ToolDefinition = {
  name: 'naver_ads_list_customers',
  description:
    '이 Space 에 연결된 네이버 검색광고 광고 계정(브랜드 → CUSTOMER_ID)을 반환합니다. include_linked=true 면 API 키 계정이 관리하는 광고주 전체 목록(/customer-links, Space 에 연결되지 않은 계정 포함)도 함께 조회합니다 — 조회 대상 계정은 연결된 브랜드로만 고를 수 있습니다.',
  inputSchema: { include_linked: z.boolean().optional() },
  mode: 'read',
  scope: 'naver:read',
  async execute(ctx, p) {
    const cred = await loadNaverCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const configured = {
      defaultBrand: cred.config.defaultBrand ?? null,
      customers: cred.config.customers,
    }
    if (!p.include_linked) return configured
    const linked = await withCredError(cred, () =>
      naverRequest(cred.secret, cred.config.managerCustomerId, 'GET', '/customer-links', {
        query: { type: 'MYCLIENTS' },
      })
    )
    return { ...configured, linked }
  },
}

const listCampaigns: ToolDefinition = {
  name: 'naver_ads_list_campaigns',
  description:
    '선택한 브랜드 광고 계정의 네이버 검색광고 캠페인 목록을 반환합니다(유형·상태·예산 포함). campaign_type 예: WEB_SITE(파워링크), SHOPPING(쇼핑검색), BRAND_SEARCH, PLACE.',
  inputSchema: {
    brand,
    campaign_type: z
      .string()
      .regex(/^[A-Z_]+$/)
      .optional(),
  },
  mode: 'read',
  scope: 'naver:read',
  async execute(ctx, p) {
    const cred = await loadNaverCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const customerId = resolveCustomer(cred.config, p.brand as string | undefined)
    return withCredError(cred, () =>
      naverRequest(cred.secret, customerId, 'GET', '/ncc/campaigns', {
        query: { campaignType: p.campaign_type as string | undefined },
      })
    )
  },
}

const listAdgroups: ToolDefinition = {
  name: 'naver_ads_list_adgroups',
  description: '네이버 검색광고 캠페인의 광고그룹 목록을 반환합니다(입찰가·예산·상태 포함).',
  inputSchema: { brand, campaign_id: z.string().regex(/^cmp-[\w-]+$/) },
  mode: 'read',
  scope: 'naver:read',
  async execute(ctx, p) {
    const cred = await loadNaverCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const customerId = resolveCustomer(cred.config, p.brand as string | undefined)
    return withCredError(cred, () =>
      naverRequest(cred.secret, customerId, 'GET', '/ncc/adgroups', {
        query: { nccCampaignId: p.campaign_id as string },
      })
    )
  },
}

const daysInclusive = (since: string, until: string) =>
  Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1

const getStats: ToolDefinition = {
  name: 'naver_ads_get_stats',
  description: `캠페인·광고그룹·키워드·소재 id 의 네이버 검색광고 성과를 반환합니다. 기간은 date_preset 또는 time_range(since·until, KST, 최대 ${MAX_RANGE_DAYS}일), 일별은 time_increment='1', 분해는 breakdown(pcMblTp·dayw·hh24·regnNo 중 1개). salesAmt(광고비)는 VAT 포함입니다.`,
  inputSchema: {
    brand,
    ids: z
      .array(z.string().regex(/^[a-z]{2,4}-[\w-]+$/))
      .min(1)
      .max(100),
    fields: z.array(z.enum(STAT_FIELDS)).min(1).optional(),
    time_range: z.object({ since: day, until: day }).optional(),
    date_preset: z
      .enum([
        'today',
        'yesterday',
        'last7days',
        'last30days',
        'lastweek',
        'lastmonth',
        'lastquarter',
      ])
      .optional(),
    time_increment: z.enum(['1', 'allDays']).optional(),
    breakdown: z.enum(['pcMblTp', 'dayw', 'hh24', 'regnNo']).optional(),
  },
  mode: 'read',
  scope: 'naver:read',
  async execute(ctx, p) {
    const range = p.time_range as { since: string; until: string } | undefined
    if (range && p.date_preset) {
      throw new ToolUserError('time_range와 date_preset은 함께 쓸 수 없습니다')
    }
    if (range) {
      if (range.since > range.until)
        throw new ToolUserError('time_range.since가 until보다 늦습니다')
      if (daysInclusive(range.since, range.until) > MAX_RANGE_DAYS) {
        throw new ToolUserError(`time_range는 최대 ${MAX_RANGE_DAYS}일입니다`)
      }
    }
    const cred = await loadNaverCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const customerId = resolveCustomer(cred.config, p.brand as string | undefined)
    return withCredError(cred, () =>
      naverRequest(cred.secret, customerId, 'GET', '/stats', {
        query: {
          ids: (p.ids as string[]).join(','),
          fields: JSON.stringify((p.fields as string[] | undefined) ?? DEFAULT_FIELDS),
          ...(range
            ? { timeRange: JSON.stringify(range) }
            : { datePreset: (p.date_preset as string | undefined) ?? 'last7days' }),
          timeIncrement: p.time_increment as string | undefined,
          breakdown: p.breakdown as string | undefined,
        },
      })
    )
  },
}

const getStatReport: ToolDefinition = {
  name: 'naver_ads_get_stat_report',
  description:
    '하루치 네이버 검색광고 대용량 보고서를 받습니다(쇼핑검색어 성과는 SHOPPINGKEYWORD_DETAIL, 쇼핑검색어 전환은 SHOPPINGKEYWORD_CONVERSION_DETAIL). 보고서를 만들고 ~15초 기다려 완성되면 행(TSV, 헤더 없음 — 열 순서는 네이버 대용량 보고서 문서 기준)을 돌려줍니다. 아직이면 status·report_job_id 를 돌려주니 report_job_id 로 다시 호출하세요. 기간이 여러 날이면 날짜별로 호출합니다.',
  inputSchema: {
    brand,
    report_type: z.enum(REPORT_TYPES).optional(),
    stat_date: day.optional().describe('YYYY-MM-DD(KST). report_job_id 가 없을 때 필수'),
    report_job_id: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]).optional(),
    limit: z.number().int().min(1).max(5000).optional().describe('돌려줄 최대 행 수(기본 1000)'),
  },
  mode: 'read',
  scope: 'naver:read',
  async execute(ctx, p) {
    const cred = await loadNaverCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const customerId = resolveCustomer(cred.config, p.brand as string | undefined)
    type Job = { reportJobId: number; status: string; downloadUrl?: string; reportTp?: string }
    const startedAt = Date.now()
    const remaining = () => REPORT_DEADLINE_MS - (Date.now() - startedAt)
    const timeoutMs = () => Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, remaining()))
    const asJob = (v: unknown): Job => {
      const j = v as Partial<Job> | null
      if (!j || typeof j !== 'object' || !j.reportJobId || typeof j.status !== 'string') {
        throw new ToolUserError('네이버 보고서 응답 형식이 올바르지 않습니다')
      }
      return j as Job
    }
    const getJob = async (id: string | number) =>
      asJob(
        await naverRequest(cred.secret, customerId, 'GET', `/stat-reports/${String(id)}`, {
          timeoutMs: timeoutMs(),
        })
      )

    return withCredError(cred, async () => {
      let job: Job
      if (p.report_job_id !== undefined) {
        job = await getJob(p.report_job_id as string | number)
      } else {
        if (!p.report_type || !p.stat_date) {
          throw new ToolUserError('report_job_id 가 없으면 report_type 과 stat_date 가 필요합니다')
        }
        job = asJob(
          await naverRequest(cred.secret, customerId, 'POST', '/stat-reports', {
            body: { reportTp: p.report_type, statDt: (p.stat_date as string).replaceAll('-', '') },
            timeoutMs: timeoutMs(),
          })
        )
      }
      for (
        let i = 0;
        i < REPORT_POLL_TRIES &&
        REPORT_PENDING.has(job.status) &&
        remaining() > REPORT_POLL_MS + 5000;
        i++
      ) {
        await new Promise((r) => setTimeout(r, REPORT_POLL_MS))
        job = await getJob(job.reportJobId)
      }
      const meta = {
        report_job_id: String(job.reportJobId),
        report_type: job.reportTp,
        status: job.status,
      }
      // 다운로드할 시간이 없으면 받지 않고 report_job_id 로 다시 부르게 한다.
      if (job.status !== 'BUILT' || !job.downloadUrl || remaining() < 5000) return meta

      const text = await naverRequest(cred.secret, customerId, 'GET', '/report-download', {
        url: assertDownloadUrl(job.downloadUrl),
        timeoutMs: timeoutMs(),
      })
      const rows = parseTsv(typeof text === 'string' ? text : '')
      const limit = (p.limit as number | undefined) ?? 1000
      return {
        ...meta,
        totalRows: rows.length,
        truncated: rows.length > limit,
        rows: rows.slice(0, limit),
      }
    })
  },
}

export const naverAdsTools: ToolDefinition[] = [
  listCustomers,
  listCampaigns,
  listAdgroups,
  getStats,
  getStatReport,
]
