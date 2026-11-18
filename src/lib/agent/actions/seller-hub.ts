import { z } from 'zod'
import type { ActionDefinition } from './types'
import { prisma } from '@/lib/prisma'
import { ToolUserError } from '@/lib/agent/tools/errors'
import {
  runReorderPlanRequest,
  type ReorderPlanRequestBody,
} from '@/lib/inv/reorder-engine/run-plan-request'
import { readTargetKeywords, applyKeywordsToTarget } from '@/lib/sh/keyword-apply'
import { applyKeywordOps } from '@/lib/sh/keyword-review'
import { lastChangeAt, isMeasuring, MEASURE_DAYS } from '@/lib/sh/keyword-review-query'
import { keywordListSchema } from '@/lib/sh/schemas'
import { buildAppUrl } from '@/lib/domain'

// 제네릭 파라미터 액션을 배열(ActionDefinition[])에 담기 위한 위더너(finance.ts와 동일 패턴).
function def<T>(d: ActionDefinition<T>): ActionDefinition {
  return d as unknown as ActionDefinition
}

// ─── 3) seller-hub.reorder.plan.create ───────────────────────────────────────
// 발주 화면 위저드와 같은 경로(runReorderPlanRequest)로 만든다 — 수량·모델·연동 위치 분리·SKU 배분·
// 자체·3PL 입고 위치가 화면에서 기본값으로 만든 계획과 같다(에밀리 보고 = 발주 화면 = 생성 계획).
// 위저드 전용 편집(옵션 최종수량 수정·모델 지정·커버일수 변경)은 받지 않는다. 근거 문구는 LLM 없이 만든다.
const reorderPlanParams = z.object({
  productId: z.string(),
  optionIds: z.array(z.string()).optional(),
  memo: z.string().optional(),
})

const reorderPlanCreate: ActionDefinition<z.infer<typeof reorderPlanParams>> = {
  actionType: 'seller-hub.reorder.plan.create',
  deckKey: 'seller-hub',
  title: '발주 계획 생성',
  paramsSchema: reorderPlanParams,
  requiredRole: 'ADMIN',
  autoExecutable: true,
  autoScope: 'sellerhub:write',
  resultUrl: (result, ctx) => {
    const planId = (result as { planId?: string } | null)?.planId
    return planId
      ? buildAppUrl(`/d/seller-ops/inventory/reorder/plans/${planId}?spaceId=${ctx.spaceId}`)
      : null
  },
  // 제안 시점 검증 — 다른 Space 의 상품 id 로 승인 불가 액션이 큐에 쌓이지 않게(실행 시점에도 spaceId 로 막는다).
  validateCreate: async (ctx, params) => {
    const product = await prisma.invProduct.findFirst({
      where: { id: params.productId, spaceId: ctx.spaceId, status: 'ACTIVE' },
      select: { id: true, reorderConfig: { select: { excludeFromForecast: true } } },
    })
    if (!product)
      throw new ToolUserError(`이 작업 공간에서 활성 상품을 찾을 수 없습니다: ${params.productId}`)
    if (product.reorderConfig?.excludeFromForecast)
      throw new ToolUserError('발주 예측에서 제외된 상품입니다. 발주 설정에서 제외를 해제하세요.')
  },
  execute: async (ctx, params) => {
    // createdById는 User FK — 제안자가 에이전트일 수 있으므로 승인한 구성원으로 기록한다.
    const userId = ctx.deciderId
    if (!userId) throw new Error('승인자 정보가 없습니다')
    const run = async (body: ReorderPlanRequestBody) => {
      const res = await runReorderPlanRequest({ spaceId: ctx.spaceId, userId }, body)
      const data = (await res.json()) as Record<string, unknown>
      if (!res.ok) throw new Error(String(data.message ?? data.error ?? '발주 계획 생성 실패'))
      return data
    }
    // 발주 화면 위저드 기본값과 같은 계획 — 연동 위치(로켓그로스) 자동 감지·SKU 배분·추천 모델·
    // 상품 설정 커버일수, 자체·3PL 입고 위치는 위저드 기본값(이 상품 재고가 가장 많은 위치).
    const base: ReorderPlanRequestBody = {
      productId: params.productId,
      ...(params.optionIds?.length ? { optionIds: params.optionIds } : {}),
      excludeRocketLayer: false,
      linkedLocationIds: [],
    }
    const preview = (await run({ ...base, dryRun: true })) as {
      ownLocations?: Array<{ id: string; isActive?: boolean }>
    }
    const created = (await run({
      ...base,
      // 자동 실행이면 계획 메모 앞에 누가 만들었는지 남긴다.
      memo: ctx.autoExecuted
        ? `[${ctx.actorName ?? '에이전트'} 자동 생성] ${params.memo ?? ''}`
        : params.memo,
      // 입고 위치는 활성 위치만 — 재고가 남은 비활성 위치는 목록엔 있어도 기본값이 될 수 없다
      ownLocationId: preview.ownLocations?.find((l) => l.isActive !== false)?.id ?? null,
      skipLlmRationale: true,
    })) as { planId: string; planNo?: string; items?: unknown[] }
    return { planId: created.planId, planNo: created.planNo, itemCount: created.items?.length ?? 0 }
  },
}

// ─── seller-hub.keywords.update ─────────────────────────────────────────────
// 상품(채널상품/단독 리스팅) 단위 키워드 추가·삭제 묶음. 상품명은 건드리지 않는다.
// 멱등: 같은 대상에 PENDING 제안이 있으면 새 제안을 거부한다(승인 큐 중복 방지).
const keywordUpdateParams = z
  .object({
    target: z
      .object({ channelProductId: z.string().optional(), listingId: z.string().optional() })
      .refine((t) => Boolean(t.channelProductId) !== Boolean(t.listingId), {
        message: 'target 은 channelProductId 또는 listingId 중 정확히 하나여야 합니다',
      }),
    add: z.array(z.string()).max(10),
    remove: z.array(z.string()).max(30),
    evidence: z.record(z.string(), z.object({ orders: z.number(), clicks: z.number() })).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((p) => p.add.length + p.remove.length > 0, {
    message: '추가 또는 삭제할 키워드가 필요합니다',
  })

type KeywordUpdateParams = z.infer<typeof keywordUpdateParams>

const keywordUpdate: ActionDefinition<KeywordUpdateParams> = {
  actionType: 'seller-hub.keywords.update',
  deckKey: 'seller-hub',
  title: '키워드 묶음 반영',
  paramsSchema: keywordUpdateParams,
  requiredRole: 'ADMIN',
  retryableAfterFailure: true, // 실패 시 단일 트랜잭션이라 변경이 남지 않는다
  validateCreate: async (ctx, params) => {
    const cur = await readTargetKeywords(ctx.spaceId, params.target)
    if (!cur) throw new ToolUserError('이 작업 공간에서 대상을 찾을 수 없습니다')
    // 그룹 소속 리스팅의 키워드는 채널상품 단위로 관리한다.
    if ('channelProductId' in cur && cur.channelProductId) {
      throw new ToolUserError(
        `그룹 소속 리스팅입니다. channelProductId(${cur.channelProductId})로 제안하세요`
      )
    }
    const r = applyKeywordOps(cur.keywords, params.add, params.remove, cur.limit)
    if (!r.ok) throw new ToolUserError(r.message)
    const valid = keywordListSchema.safeParse(r.keywords)
    if (!valid.success)
      throw new ToolUserError(valid.error.issues[0]?.message ?? '키워드 형식 오류')
    const id = params.target.channelProductId ?? params.target.listingId
    const key = params.target.channelProductId ? 'channelProductId' : 'listingId'
    const dup = await prisma.agentPendingAction.findFirst({
      where: {
        spaceId: ctx.spaceId,
        actionType: 'seller-hub.keywords.update',
        status: 'PENDING',
        expiresAt: { gt: new Date() }, // 만료됐지만 아직 EXPIRED 전환 전인 제안은 중복으로 보지 않는다
        payload: { path: ['target', key], equals: id },
      },
      select: { id: true },
    })
    if (dup) throw new ToolUserError(`이미 승인 대기 중인 키워드 제안이 있습니다: ${dup.id}`)
    const at = (
      await lastChangeAt(ctx.spaceId, [
        { kind: params.target.channelProductId ? 'channelProduct' : 'listing', id: id! },
      ])
    ).get(id!)
    if (isMeasuring(at))
      throw new ToolUserError(
        `최근 ${MEASURE_DAYS}일 안에 상품명·키워드가 바뀐 상품입니다(${at!.toISOString().slice(0, 10)}). 효과 측정이 끝난 뒤 제안하세요`
      )
  },
  snapshot: async (ctx, params) => {
    const cur = await readTargetKeywords(ctx.spaceId, params.target)
    return cur
      ? { name: cur.name, keywordCount: cur.keywords.length, keywords: cur.keywords.join(', ') }
      : null
  },
  execute: async (ctx, params) => {
    const cur = await readTargetKeywords(ctx.spaceId, params.target)
    if (!cur) throw new Error('대상을 찾을 수 없습니다')
    const r = applyKeywordOps(cur.keywords, params.add, params.remove, cur.limit)
    if (!r.ok) throw new Error(r.message)
    const valid = keywordListSchema.safeParse(r.keywords)
    if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? '키워드 형식 오류')
    await applyKeywordsToTarget({
      spaceId: ctx.spaceId,
      target: params.target,
      before: cur.keywords,
      after: r.keywords,
      name: cur.name,
      productId: cur.productId,
      channelProductId: 'channelProductId' in cur ? cur.channelProductId : null,
      actorUserId: ctx.deciderId ?? null,
    })
    return { before: cur.keywords, after: r.keywords }
  },
}

// seller-hub deck 승인 큐 액션.
export const sellerHubActions: ActionDefinition[] = [def(reorderPlanCreate), def(keywordUpdate)]
