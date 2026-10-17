import { z } from 'zod'
import { createPendingAction } from '@/lib/agent/actions/create'
import {
  META_ACTIONS,
  assertMetaTarget,
  assertObjectInAccount,
  graphRequest,
  loadMetaCred,
  resolveAdAccount,
  validateMetaAction,
} from '@/lib/agent/integrations/meta-ads'
import { makeListActionsTool } from './action-list-tools'
import { ToolUserError } from './errors'
import type { ToolDefinition } from './types'

/**
 * 메타 광고 도구 — 에밀리 meta-ads-server.mjs 이식.
 * 승인·실행 도구(meta_ads_approve_action·meta_ads_execute_approved_action)는 옮기지 않는다
 * (승인은 구성원만: workdeck 승인 UI·Slack 버튼, 실행은 approveAndExecute).
 */
const brand = z
  .string()
  .optional()
  .describe('브랜드 키(Space 메타 광고 자격증명의 adAccounts 키). 없으면 기본 브랜드')

const listCampaigns: ToolDefinition = {
  name: 'meta_ads_list_campaigns',
  description: '선택한 브랜드 광고 계정의 메타 캠페인 목록을 반환합니다(상태·목표·예산 포함).',
  inputSchema: {
    brand,
    limit: z.number().int().min(1).max(200).optional(),
    effective_status: z.array(z.string()).optional(),
  },
  mode: 'read',
  scope: 'meta:read',
  async execute(ctx, p) {
    const cred = await loadMetaCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const account = resolveAdAccount(cred.config, p.brand as string | undefined)
    return graphRequest(cred, 'GET', `/${account}/campaigns`, {
      fields:
        'id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time',
      limit: (p.limit as number | undefined) ?? 25,
      effective_status: p.effective_status,
    })
  },
}

const listAds: ToolDefinition = {
  name: 'meta_ads_list_ads',
  description:
    '선택한 브랜드 광고 계정의 광고를 게재 상태(effective_status, 기본 ACTIVE)별로 반환합니다.',
  inputSchema: {
    brand,
    limit: z.number().int().min(1).max(500).optional(),
    effective_status: z.array(z.string()).optional(),
  },
  mode: 'read',
  scope: 'meta:read',
  async execute(ctx, p) {
    const cred = await loadMetaCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const account = resolveAdAccount(cred.config, p.brand as string | undefined)
    return graphRequest(cred, 'GET', `/${account}/ads`, {
      fields: 'id,name,status,effective_status,campaign_id,adset_id,updated_time',
      limit: (p.limit as number | undefined) ?? 100,
      effective_status: (p.effective_status as string[] | undefined) ?? ['ACTIVE'],
    })
  },
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const BREAKDOWNS = [
  'age',
  'gender',
  'publisher_platform',
  'platform_position',
  'impression_device',
  'hourly_stats_aggregated_by_advertiser_time_zone',
] as const

const getInsights: ToolDefinition = {
  name: 'meta_ads_get_insights',
  description:
    '계정·캠페인·광고세트·광고의 성과(지출·노출·클릭·전환·ROAS)를 반환합니다. object_id를 주지 않으면 브랜드 광고 계정 기준입니다. 이 Space 광고 계정에 속한 객체만 조회할 수 있습니다. 기간은 date_preset 또는 time_range(since·until), 일별은 time_increment=1, 분해는 breakdowns(age·gender·publisher_platform·platform_position·impression_device·hourly), 다음 페이지는 paging.cursors.after를 after로 넘깁니다.',
  inputSchema: {
    brand,
    object_id: z
      .string()
      .regex(/^(act_)?\d+$/)
      .optional(),
    date_preset: z.string().optional(),
    time_range: z
      .object({ since: z.string().regex(DAY), until: z.string().regex(DAY) })
      .optional()
      .describe('조회 기간(YYYY-MM-DD, 광고 계정 시간대). 주면 date_preset을 쓰지 않는다'),
    time_increment: z
      .union([z.number().int().min(1).max(90), z.enum(['monthly', 'all_days'])])
      .optional()
      .describe('기간을 나눌 단위: 1=일별, 7=주별, monthly, all_days'),
    breakdowns: z.array(z.enum(BREAKDOWNS)).min(1).max(3).optional(),
    after: z.string().min(1).max(512).optional().describe('이전 응답 paging.cursors.after'),
    level: z.enum(['account', 'campaign', 'adset', 'ad']).optional(),
    fields: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  mode: 'read',
  scope: 'meta:read',
  async execute(ctx, p) {
    const range = p.time_range as { since: string; until: string } | undefined
    if (range && p.date_preset) {
      throw new ToolUserError('time_range와 date_preset은 함께 쓸 수 없습니다')
    }
    if (range && range.since > range.until) {
      throw new ToolUserError('time_range.since가 until보다 늦습니다')
    }
    const cred = await loadMetaCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const account = resolveAdAccount(cred.config, p.brand as string | undefined)
    const objectId = (p.object_id as string | undefined) ?? account
    await assertObjectInAccount(cred, objectId, account)
    return graphRequest(cred, 'GET', `/${objectId}/insights`, {
      ...(range
        ? { time_range: range }
        : { date_preset: (p.date_preset as string | undefined) ?? 'last_30d' }),
      level: (p.level as string | undefined) ?? 'campaign',
      fields:
        (p.fields as string | undefined) ??
        'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,conversions,purchase_roas',
      limit: (p.limit as number | undefined) ?? 50,
      time_increment: p.time_increment as string | number | undefined,
      breakdowns: (p.breakdowns as string[] | undefined)?.join(','),
      after: p.after as string | undefined,
    })
  },
}

const proposeAction: ToolDefinition = {
  name: 'meta_ads_propose_action',
  description: `메타 광고 변경을 제안합니다(${Object.keys(META_ACTIONS).join(', ')}). 즉시 실행되지 않고 승인 대기 큐에 등록되며, create·update는 등록 전에 Meta에 validate_only로 미리 검증해 거부될 요청이면 오류를 돌려줍니다(adstudy.* 제외). 구성원이 승인한 뒤에만 Meta API를 호출합니다. 예산이 Space 승인 한도를 넘는 변경은 OWNER 승인이 필요합니다. 예산 변경은 KRW 광고 계정만 지원합니다. adstudy.*(A/B 테스트)는 business_id·study_id를 경로에만 씁니다.`,
  inputSchema: {
    brand,
    action: z.enum(Object.keys(META_ACTIONS) as [string, ...string[]]),
    params: z.record(z.string(), z.unknown()),
    summary: z.string().min(1).max(300),
  },
  mode: 'write',
  scope: 'meta:write',
  async execute(ctx, p) {
    const { action, params } = validateMetaAction({ action: p.action, params: p.params })
    // 계정 매핑·통화를 확인한다. 같은 검사를 validateCreate(create·update는 Meta validate_only 포함)와 execute가 다시 한다.
    const cred = await loadMetaCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const brandKey = (p.brand as string | undefined) || cred.config.defaultBrand
    const adAccountId = assertMetaTarget(cred.config, { brand: brandKey, action })
    return createPendingAction({
      spaceId: ctx.spaceId,
      actionType: `meta-ads.${action}`,
      params: { brand: brandKey, adAccountId, params },
      summary: p.summary as string,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
    })
  },
}

export const metaAdsTools: ToolDefinition[] = [
  listCampaigns,
  listAds,
  getInsights,
  proposeAction,
  makeListActionsTool({
    name: 'meta_ads_list_actions',
    deckKey: 'meta-ads',
    scope: 'meta:read',
    label: '메타 광고',
  }),
]
