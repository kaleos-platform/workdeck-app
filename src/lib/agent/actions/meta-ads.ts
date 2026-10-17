import { z } from 'zod'
import { loadSpaceCredentialConfig } from '@/lib/agent/integrations/space-credential'
import {
  META_ACTIONS,
  META_BUDGET_ACTIONS,
  META_VALIDATE_ONLY_ACTIONS,
  PROVIDER,
  assertActionInAccount,
  assertMetaTarget,
  graphRequest,
  loadMetaCred,
  metaActionRequest,
  MetaApiError,
  metaSpendKrw,
  recordMetaError,
  validateMetaAction,
  type MetaActionName,
  type MetaConfig,
} from '@/lib/agent/integrations/meta-ads'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { maskSecrets } from '@/lib/agent/audit'
import type { ActionDefinition } from './types'

const baseSchema = z.object({
  brand: z.string().min(1), // 대상은 brand → 현재 config로 다시 해석한다. adAccountId는 비교용
  adAccountId: z.string().regex(/^act_\d+$/),
  params: z.record(z.string(), z.unknown()),
})
type Params = z.infer<typeof baseSchema>

function defineMetaAction(name: MetaActionName): ActionDefinition<Params> {
  // 저장된 payload도 허용 목록을 통과해야 한다 — 실패하면 requiredDecisionRole이 OWNER로 판정하고 생성도 거부된다.
  const paramsSchema = baseSchema.superRefine((p, issue) => {
    try {
      validateMetaAction({ action: name, params: p.params })
    } catch (err) {
      issue.addIssue({ code: 'custom', message: err instanceof Error ? err.message : String(err) })
    }
  })
  return {
    actionType: `meta-ads.${name}`,
    deckKey: 'meta-ads',
    title: `메타 광고: ${name}`,
    paramsSchema,
    requiredRole: 'ADMIN',
    // 예산 파라미터가 Space.approvalLimitKrw(null=0)를 넘으면 OWNER만 승인한다(requiredDecisionRole).
    spendKrw: (p) => (META_BUDGET_ACTIONS.has(name) ? metaSpendKrw(p.params) : null),
    expiryHours: 24,
    // 생성 시점(MCP 제안·세션 POST 모두): params 형태, payload 계정이 현재 Space 매핑과 같은지, 예산이면 KRW 확인 계정인지.
    // create·update는 Meta에 validate_only로 같은 요청을 미리 보내, Meta가 거부할 제안을 승인 전에 돌려준다.
    validateCreate: async (ctx, p) => {
      validateMetaAction({ action: name, params: p.params })
      const config = await loadSpaceCredentialConfig<MetaConfig>(ctx.spaceId, PROVIDER)
      const adAccountId = assertMetaTarget(config, {
        brand: p.brand,
        action: name,
        adAccountId: p.adAccountId,
      })
      if (META_VALIDATE_ONLY_ACTIONS.has(name)) await validateOnly(ctx, name, adAccountId, p.params)
    },
    // 승인 뒤에만 호출된다(approveAndExecute 게이트). 실행 시점에 대상을 다시 해석하고 계정 소속을 확인한다.
    // 감사 행은 approveAndExecute가 남긴다. 여기서는 복호화한 자격증명 id만 ctx에 넣는다.
    execute: async (ctx, p) => {
      validateMetaAction({ action: name, params: p.params })
      const cred = await loadMetaCred(ctx.spaceId, ctx.decryptedCredentialIds)
      const adAccountId = assertMetaTarget(cred.config, {
        brand: p.brand,
        action: name,
        adAccountId: p.adAccountId,
      })
      const { endpoint, body } = metaActionRequest(name, adAccountId, p.params)
      try {
        await assertActionInAccount(cred, name, p.params, adAccountId)
        return await graphRequest(cred, 'POST', endpoint, body)
      } catch (err) {
        // 소속 확인 GET·실행 POST의 Graph 오류(토큰 만료 등)만 기록한다. 경계 거부는 자격증명 문제가 아니다.
        if (err instanceof MetaApiError) await recordMetaError(cred.id, err)
        throw err
      }
    },
  }
}

// 실행과 같은 요청(metaActionRequest)에 validate_only만 더한다. 연결 실패도 거부한다(검증 못 한 제안을 큐에 넣지 않음).
// 검증 단계 오류는 대부분 파라미터 문제라 자격증명 lastError에 기록하지 않는다.
async function validateOnly(
  ctx: { spaceId: string; decryptedCredentialIds: string[] },
  name: MetaActionName,
  adAccountId: string,
  params: Record<string, unknown>
): Promise<void> {
  const cred = await loadMetaCred(ctx.spaceId, ctx.decryptedCredentialIds)
  const { endpoint, body } = metaActionRequest(name, adAccountId, params)
  try {
    await assertActionInAccount(cred, name, params, adAccountId)
    await graphRequest(cred, 'POST', endpoint, { ...body, execution_options: ['validate_only'] })
  } catch (err) {
    if (!(err instanceof MetaApiError)) throw err
    throw new ToolUserError(`Meta 사전 검증 실패: ${maskSecrets(err.message)}`)
  }
}

export const metaAdsActions: ActionDefinition[] = (
  Object.keys(META_ACTIONS) as MetaActionName[]
).map((n) => defineMetaAction(n) as unknown as ActionDefinition)
