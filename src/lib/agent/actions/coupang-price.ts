import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { checkPriceGuards } from '@/lib/sh/coupang-price/price-round'
import { requireCoupangWorkspaceId } from '@/lib/coupang/workspace-space'
import type { ActionDefinition } from './types'

const targetSchema = z.object({
  listingId: z.string(),
  vendorItemId: z.string(),
  listingName: z.string(),
  currentPrice: z.number().nullable(), // 스냅샷 기준 참고값
  targetPrice: z.number().int().positive(), // 10원 반올림 완료
  apMinSalePrice: z.number().int().positive(), // 10원 올림 완료
})

const params = z.object({
  channelAxis: z.enum(['RG', 'MP']),
  channelId: z.string(),
  apActive: z.boolean(),
  targets: z.array(targetSchema).min(1),
  rationale: z.object({
    costPrice: z.number(),
    channelFeePct: z.number(),
    shippingCost: z.number(),
    targetMargin: z.number(),
    computedMargin: z.number(),
    discountRate: z.number(),
    promotionLabel: z.string().nullable(),
    includeVat: z.boolean(),
    vatRate: z.number(),
  }),
  scenarioId: z.string().optional(),
})

type Params = z.infer<typeof params>

const paramsWithGuards = params.superRefine((v, ctx) => {
  for (const t of v.targets) {
    const guard = checkPriceGuards({
      price: t.targetPrice,
      apMinSalePrice: t.apMinSalePrice,
      includeVat: v.rationale.includeVat,
    })
    if (!guard.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: guard.reason })
    }
    if (t.targetPrice % 10 !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '판매가는 10원 단위여야 합니다',
      })
    }
  }
}) as unknown as z.ZodType<Params>

export const coupangPriceChange: ActionDefinition<Params> = {
  actionType: 'seller-hub.coupang-price.change',
  // 가격 변경은 광고가 아니고, 사용자가 되돌아갈 화면이 가격시뮬(seller-hub)이다.
  deckKey: 'seller-hub',
  title: '쿠팡 판매가 반영',
  paramsSchema: paramsWithGuards,
  requiredRole: 'ADMIN',
  // 가격 액션은 6시간 만료(다른 액션은 기본 72시간) — 실판매가가 스냅샷과
  // 어긋날 여지를 짧게 잡는다.
  expiryHours: 6,

  // 생성 시점 가드 — space에 쿠팡 워크스페이스가 연결되어 있지 않으면
  // 승인 큐에 올리지 않는다(승인 시점·워커 실행 시점에 실패시키면 사람이
  // 실행 불가능한 액션을 이미 승인한 뒤가 된다).
  validateCreate: async (ctx) => {
    await requireCoupangWorkspaceId(ctx.spaceId)
  },

  // 승인 시점의 스냅샷 가격. 차단용이 아니라 감사용이다 —
  // 자동조정이 켜진 옵션은 이 값과 실행 시점 가격이 다른 것이 정상이다.
  snapshot: async (ctx, p) =>
    prisma.coupangProductItem.findMany({
      where: { spaceId: ctx.spaceId, listingId: { in: p.targets.map((t) => t.listingId) } },
      select: { listingId: true, rgSalePrice: true, mpSalePrice: true, collectedAt: true },
    }),

  // 쿠팡 API 는 allowlist IP(워커)에서만 호출된다. 여기서는 잡만 만든다.
  execute: async (ctx, p) => {
    const workspaceId = await requireCoupangWorkspaceId(ctx.spaceId)
    const job = await prisma.coupangWriteJob.create({
      data: {
        workspaceId,
        spaceId: ctx.spaceId,
        actionId: ctx.actionId,
        kind: 'PRICE_CHANGE',
        payload: p as unknown as object,
      },
    })
    return { jobId: job.id, status: 'queued', targets: p.targets.length }
  },
}
