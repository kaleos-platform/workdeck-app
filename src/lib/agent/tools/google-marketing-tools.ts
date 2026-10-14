import { z } from 'zod'
import { createPendingAction } from '@/lib/agent/actions/create'
import { loadSpaceCredentialConfig } from '@/lib/agent/integrations/space-credential'
import {
  AGENT_GTM_TAG_TYPES,
  AGENT_GTM_VARIABLE_TYPES,
  GA4_ADMIN_BASE,
  GA4_DATA_BASE,
  GOOGLE_ACTIONS,
  GTM_BASE,
  PROVIDER,
  actionUrl,
  assertQueryKeys,
  googleRequest,
  loadGoogleCred,
  resolveBrand,
  targetUrl,
  validateGa4RunReportRequest,
  validateGoogleAction,
  type GoogleConfig,
} from '@/lib/agent/integrations/google-marketing'
import { makeListActionsTool } from './action-list-tools'
import type { ToolDefinition } from './types'

/**
 * 구글 마케팅(GA4·GTM) 도구 — 에밀리 google-marketing-server.mjs 이식.
 * 승인·실행 도구(google_marketing_approve_action·google_marketing_execute_approved_action)는 옮기지 않는다
 * (승인은 구성원만: workdeck 승인 UI·Slack 버튼, 실행은 approveAndExecute).
 * 원본 admin_get·gtm_get은 임의 path를 받았지만 여기서는 브랜드 GA4 속성·GTM 컨테이너 아래로만 제한한다.
 */
const brand = z
  .string()
  .optional()
  .describe('브랜드 키(Space 구글 마케팅 자격증명의 brands 키). 없으면 기본 브랜드')
const query = z.record(z.string(), z.string()).optional()

const runReport: ToolDefinition = {
  name: 'google_marketing_ga4_run_report',
  description:
    '선택한 브랜드 GA4 속성에 Data API runReport를 실행합니다. request는 RunReportRequest 본문입니다(dateRange는 dimension이 아님, 구매 수는 ecommercePurchases).',
  inputSchema: { brand, request: z.record(z.string(), z.unknown()) },
  mode: 'read',
  scope: 'google:read',
  async execute(ctx, p) {
    const request = validateGa4RunReportRequest(p.request)
    const cred = await loadGoogleCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const t = resolveBrand(cred.config, p.brand as string | undefined)
    // 경로는 config의 숫자 id로만 만든다(사용자 입력 없음).
    const url = new URL(`${GA4_DATA_BASE}/properties/${t.ga4_property_id}:runReport`)
    return googleRequest(cred, 'POST', url, request)
  },
}

const adminGet: ToolDefinition = {
  name: 'google_marketing_ga4_admin_get',
  description:
    'GA4 Admin API GET. path는 이 브랜드 GA4 속성 아래여야 합니다(예: /v1beta/properties/<속성>/dataStreams).',
  inputSchema: { brand, path: z.string().min(1), query },
  mode: 'read',
  scope: 'google:read',
  async execute(ctx, p) {
    const cred = await loadGoogleCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const t = resolveBrand(cred.config, p.brand as string | undefined)
    // OAuth 토큰 요청 전에 검사한다.
    const url = targetUrl(GA4_ADMIN_BASE, p.path as string, t, 'ga4-admin')
    return googleRequest(
      cred,
      'GET',
      url,
      assertQueryKeys((p.query as Record<string, string>) ?? {})
    )
  },
}

const gtmGet: ToolDefinition = {
  name: 'google_marketing_gtm_get',
  description:
    'Google Tag Manager API v2 GET. path는 이 브랜드 GTM 컨테이너 아래여야 합니다(예: /accounts/<계정>/containers/<컨테이너>/workspaces).',
  inputSchema: { brand, path: z.string().min(1), query },
  mode: 'read',
  scope: 'google:read',
  async execute(ctx, p) {
    const cred = await loadGoogleCred(ctx.spaceId, ctx.decryptedCredentialIds)
    const t = resolveBrand(cred.config, p.brand as string | undefined)
    const url = targetUrl(GTM_BASE, p.path as string, t, 'gtm')
    return googleRequest(
      cred,
      'GET',
      url,
      assertQueryKeys((p.query as Record<string, string>) ?? {})
    )
  },
}

const propose: ToolDefinition = {
  name: 'google_marketing_propose_action',
  description: `GA4·GTM 변경을 제안합니다(${Object.keys(GOOGLE_ACTIONS).join(', ')}). 즉시 실행되지 않고 승인 대기 큐에 등록되며, 구성원이 승인한 뒤에만 Google API를 호출합니다. params는 액션별 허용 키만 받고, name/parent/path는 이 브랜드 속성·컨테이너의 리소스 경로여야 합니다. gtm.*.update는 PUT(전체 교체)이라 리소스 전체 본문을 보내야 합니다 — gtm_get 결과에서 accountId·containerId·workspaceId·tagId/triggerId/variableId·fingerprint·tagManagerUrl은 빼세요. GA4 patch는 updateMask를 함께 보내세요. GTM 태그·변수는 표준 타입만 다룰 수 있습니다(태그 ${[...AGENT_GTM_TAG_TYPES].join('·')}, 변수 ${[...AGENT_GTM_VARIABLE_TYPES].join('·')}; create는 type 필수). 맞춤 HTML·JavaScript·이미지·커스텀 템플릿은 GTM 화면에서 사람이 만듭니다. ga4.measurement_protocol_secret.create로 만든 비밀값은 결과에서 가려지므로 GA4 화면에서 확인해야 합니다. gtm.version.publish는 OWNER 승인이 필요합니다.`,
  inputSchema: {
    brand,
    action: z.enum(Object.keys(GOOGLE_ACTIONS) as [string, ...string[]]),
    params: z.record(z.string(), z.unknown()),
    summary: z.string().min(1).max(300),
  },
  mode: 'write',
  scope: 'google:write',
  async execute(ctx, p) {
    const { action, params } = validateGoogleAction({ action: p.action, params: p.params })
    // config만 본다(복호화·Google API 호출 없음). 같은 검사를 validateCreate와 execute가 다시 한다.
    const config = await loadSpaceCredentialConfig<GoogleConfig>(ctx.spaceId, PROVIDER)
    const target = resolveBrand(config, p.brand as string | undefined)
    actionUrl(action, params, target)
    return createPendingAction({
      spaceId: ctx.spaceId,
      actionType: `google-marketing.${action}`,
      params: { target, params },
      summary: p.summary as string,
      source: 'MCP',
      actor: ctx.actor,
      requesterUserId: ctx.requesterUserId,
      requesterSlackUserId: ctx.requesterSlackUserId,
      workId: ctx.workId,
    })
  },
}

export const googleMarketingTools: ToolDefinition[] = [
  runReport,
  adminGet,
  gtmGet,
  propose,
  makeListActionsTool({
    name: 'google_marketing_list_actions',
    deckKey: 'google-marketing',
    scope: 'google:read',
    label: '구글 마케팅',
  }),
]
