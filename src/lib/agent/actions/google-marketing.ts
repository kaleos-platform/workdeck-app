import { z } from 'zod'
import { loadSpaceCredentialConfig } from '@/lib/agent/integrations/space-credential'
import {
  GOOGLE_ACTIONS,
  PROVIDER,
  actionUrl,
  assertAgentGtmType,
  assertGoogleTarget,
  cleanBodyParams,
  googleRequest,
  loadGoogleCred,
  validateGoogleAction,
  type GoogleConfig,
} from '@/lib/agent/integrations/google-marketing'
import type { ActionDefinition } from './types'

const id = z.string().regex(/^\d+$/)
const baseSchema = z.object({
  // 대상은 brand → 현재 config로 다시 해석한다. 숫자 id는 비교용(assertGoogleTarget).
  target: z.object({
    brand: z.string().min(1),
    ga4_property_id: id,
    gtm_account_id: id,
    gtm_container_id: id,
  }),
  params: z.record(z.string(), z.unknown()),
})
type Params = z.infer<typeof baseSchema>

// 돈이 나가는 액션이 없다(GA4·GTM 설정만) — spendKrw를 두지 않는다.
function define(action: string): ActionDefinition<Params> {
  const spec = GOOGLE_ACTIONS[action]
  // 저장된 payload도 허용 목록을 통과해야 한다 — 실패하면 생성이 거부된다.
  const paramsSchema = baseSchema.superRefine((p, issue) => {
    try {
      validateGoogleAction({ action, params: p.params })
    } catch (err) {
      issue.addIssue({ code: 'custom', message: err instanceof Error ? err.message : String(err) })
    }
  })
  return {
    actionType: `google-marketing.${action}`,
    deckKey: 'google-marketing',
    title: `구글 마케팅: ${action}`,
    paramsSchema,
    // GTM 게시(version.publish)는 운영 사이트 태그를 바꾸므로 OWNER. 나머지는 ADMIN.
    requiredRole: action === 'gtm.version.publish' ? 'OWNER' : 'ADMIN',
    expiryHours: 24,
    // 생성 시점(MCP 제안·세션 POST 모두): params 허용 목록, payload target이 현재 매핑과 같은지,
    // 최종 URL이 브랜드 범위인지. Google API는 부르지 않는다(config만 본다).
    validateCreate: async (ctx, p) => {
      validateGoogleAction({ action, params: p.params })
      const config = await loadSpaceCredentialConfig<GoogleConfig>(ctx.spaceId, PROVIDER)
      actionUrl(action, p.params, assertGoogleTarget(config, p.target))
    },
    // 승인 뒤 실행: 대상을 현재 config로 다시 해석하고(매핑 변경 시 실패), 검사한 URL로만 요청한다.
    // 감사 행은 approveAndExecute가 남긴다. 복호화한 자격증명 id만 ctx에 넣는다.
    execute: async (ctx, p) => {
      validateGoogleAction({ action, params: p.params })
      const cred = await loadGoogleCred(ctx.spaceId, ctx.decryptedCredentialIds)
      const url = actionUrl(action, p.params, assertGoogleTarget(cred.config, p.target))
      if (action === 'gtm.tag.update' || action === 'gtm.variable.update') {
        // 허용 목록 밖의 기존 태그·변수(맞춤 HTML·커스텀 템플릿 등)의 다른 필드(발동 트리거 등)를 고쳐 되살리는 것을 막는다.
        // 새 type(있으면)은 validateGoogleAction이 이미 확인했다. 기존 type도 허용 목록이어야 한다.
        const existing = (await googleRequest(cred, 'GET', url)) as { type?: unknown }
        assertAgentGtmType(existing?.type ?? null, action === 'gtm.tag.update' ? 'tag' : 'variable')
      }
      return googleRequest(cred, spec.method, url, cleanBodyParams(p.params, action))
    },
  }
}

export const googleMarketingActions: ActionDefinition[] = Object.keys(GOOGLE_ACTIONS).map(
  (a) => define(a) as unknown as ActionDefinition
)
