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
import { getTodayStrKst } from '@/lib/date-range'
import { lockStockLevel, setStockLevel } from '@/lib/inv/movement-processor'

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
  scope: 'sellerhub:write', // 내부: DRAFT 계획만 만든다
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
  scope: 'sellerhub:write', // 내부: 워크덱 DB 키워드 저장·변경 이력만(applyKeywordsToTarget 에 외부 호출 없음)
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

// ─── 4) seller-hub.stock.adjust ──────────────────────────────────────────────
// 화면 「조정」과 같은 결과(InvStockLevel 절대값 + ADJUSTMENT 이동 기록). 항상 웹 단건 승인.
// 제안 시점 재고(수량 + updatedAt)를 expectedBefore/expectedUpdatedAt 로 박아 두고, 실행 때 하나라도 다르면 전체 실패.
const stockAdjustParams = z.object({
  locationId: z.string(),
  items: z
    .array(
      z.object({
        optionId: z.string(),
        quantity: z.number().int().min(0),
        expectedBefore: z.number().int(),
        expectedUpdatedAt: z.string().nullable(),
      })
    )
    .min(1)
    .max(50)
    .refine((a) => new Set(a.map((i) => i.optionId)).size === a.length, {
      message: '같은 옵션이 중복되었습니다',
    }),
  reason: z.string().trim().min(1).max(500),
  movementDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

type StockAdjustParams = z.infer<typeof stockAdjustParams>
type StockDb = Pick<typeof prisma, 'invStorageLocation' | 'invProductOption'>

// 위치·옵션 자격 확인 — validateCreate 와 execute(트랜잭션 안)가 같은 조건을 쓴다.
async function loadStockAdjustTargets(db: StockDb, spaceId: string, params: StockAdjustParams) {
  const location = await db.invStorageLocation.findFirst({
    where: { id: params.locationId, spaceId },
  })
  if (!location || !location.isActive)
    throw new ToolUserError('보관 장소를 찾을 수 없거나 비활성입니다')
  if (location.externalSource || (location.syncProvider && location.autoReconcileWeekly))
    throw new ToolUserError('자동 연동되는 위치는 재고를 조정할 수 없습니다')
  const ids = params.items.map((i) => i.optionId)
  const options = await db.invProductOption.findMany({
    where: { id: { in: ids }, deletedAt: null, product: { spaceId, status: 'ACTIVE' } },
    select: { id: true, name: true, sku: true },
  })
  const byId = new Map(options.map((o) => [o.id, o]))
  const missing = ids.find((id) => !byId.has(id))
  if (missing)
    throw new ToolUserError(`옵션을 찾을 수 없거나 사용할 수 없는 상품입니다: ${missing}`)
  return { location, byId }
}

const optionLabel = (o: { name: string; sku: string | null }) =>
  o.sku ? `${o.name} (${o.sku})` : o.name

const stockAdjust: ActionDefinition<StockAdjustParams> = {
  actionType: 'seller-hub.stock.adjust',
  deckKey: 'seller-hub',
  title: '재고 조정(실물 수량으로 맞춤)',
  paramsSchema: stockAdjustParams,
  requiredRole: 'ADMIN',
  scope: 'sellerhub:write',
  external: true, // 사람이 관리하는 재고 기준값을 덮어쓴다 — 쓰기 권한이 있어도 승인 후 실행
  requiresWebReview: () => true, // 전후 수량을 보고 단건 승인
  retryableAfterFailure: true, // 단일 트랜잭션 — 실패하면 변경이 남지 않는다
  resultUrl: (_r, ctx) => buildAppUrl(`/d/seller-ops/inventory/movements?spaceId=${ctx.spaceId}`),
  validateCreate: async (ctx, params) => {
    const { byId } = await loadStockAdjustTargets(prisma, ctx.spaceId, params)
    const rows = await prisma.invStockLevel.findMany({
      // execute 의 findUnique(optionId_locationId)와 같은 기준 — Space 는 위치·옵션 검증이 보장
      where: {
        locationId: params.locationId,
        optionId: { in: params.items.map((i) => i.optionId) },
      },
      select: { optionId: true, quantity: true, updatedAt: true },
    })
    const cur = new Map(rows.map((r) => [r.optionId, r]))
    for (const it of params.items) {
      if (it.quantity === it.expectedBefore)
        throw new ToolUserError(
          `현재 재고와 같아 조정할 필요가 없습니다: ${optionLabel(byId.get(it.optionId)!)}`
        )
      const row = cur.get(it.optionId)
      if (
        (row?.quantity ?? 0) !== it.expectedBefore ||
        (row?.updatedAt.toISOString() ?? null) !== it.expectedUpdatedAt
      )
        throw new ToolUserError(
          `현재 재고가 제안 기준과 다릅니다: ${optionLabel(byId.get(it.optionId)!)}`
        )
    }
    // best-effort 중복 차단 — 동시 제안은 못 막지만 실행 시 updatedAt 검사가 덮어쓰기를 막는다.
    const pending = await prisma.agentPendingAction.findMany({
      where: {
        spaceId: ctx.spaceId,
        actionType: 'seller-hub.stock.adjust',
        status: 'PENDING',
        expiresAt: { gt: new Date() },
        payload: { path: ['locationId'], equals: params.locationId },
      },
      select: { id: true, payload: true },
    })
    const mine = new Set(params.items.map((i) => i.optionId))
    for (const p of pending) {
      const items = (p.payload as { items?: { optionId?: string }[] } | null)?.items ?? []
      if (items.some((i) => i.optionId && mine.has(i.optionId)))
        throw new ToolUserError(`이미 승인 대기 중인 재고 조정 제안이 있습니다: ${p.id}`)
    }
  },
  snapshot: async (ctx, params) => {
    const { location, byId } = await loadStockAdjustTargets(prisma, ctx.spaceId, params)
    const out: Record<string, string> = { 위치: location.name }
    for (const it of params.items) {
      const d = it.quantity - it.expectedBefore
      out[optionLabel(byId.get(it.optionId)!)] =
        `${it.expectedBefore} → ${it.quantity} (${d > 0 ? '+' : ''}${d})`
    }
    return out
  },
  execute: async (ctx, params) => {
    const movementDate = new Date(params.movementDate ?? getTodayStrKst())
    const items = [...params.items].sort((a, b) => (a.optionId < b.optionId ? -1 : 1)) // 교착 방지
    return prisma.$transaction(async (tx) => {
      const { byId } = await loadStockAdjustTargets(tx, ctx.spaceId, params)
      const adjusted: { optionId: string; before: number; after: number; delta: number }[] = []
      for (const it of items) {
        // 재고 행이 없으면 FOR UPDATE 가 잠글 게 없다 — upsertStockLevel 과 같은 advisory lock 을 먼저 잡는다.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${it.optionId} || ':' || ${params.locationId}))`
        await lockStockLevel(tx, it.optionId, params.locationId)
        const row = await tx.invStockLevel.findUnique({
          where: { optionId_locationId: { optionId: it.optionId, locationId: params.locationId } },
        })
        if (
          (row?.quantity ?? 0) !== it.expectedBefore ||
          (row?.updatedAt.toISOString() ?? null) !== it.expectedUpdatedAt
        )
          throw new Error(`제안 이후 재고가 바뀌었습니다: ${optionLabel(byId.get(it.optionId)!)}`)
        const { before, after } = await setStockLevel(
          tx,
          ctx.spaceId,
          it.optionId,
          params.locationId,
          it.quantity
        )
        const delta = after - before
        await tx.invMovement.create({
          data: {
            spaceId: ctx.spaceId,
            optionId: it.optionId,
            locationId: params.locationId,
            type: 'ADJUSTMENT',
            quantity: delta,
            movementDate,
            reason: `${params.reason} (에이전트 제안 승인)`,
            referenceId: ctx.actionId ?? null,
          },
        })
        adjusted.push({ optionId: it.optionId, before, after, delta })
      }
      return { locationId: params.locationId, adjusted }
    })
  },
}

// seller-hub deck 승인 큐 액션.
export const sellerHubActions: ActionDefinition[] = [
  def(reorderPlanCreate),
  def(keywordUpdate),
  def(stockAdjust),
]
