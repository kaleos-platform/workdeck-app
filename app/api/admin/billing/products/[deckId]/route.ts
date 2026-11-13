import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { invalidateDeckReleaseCache } from '@/lib/billing/deck-release'
import type { Prisma } from '@/generated/prisma/client'

const patchSchema = z
  .object({
    pricingMode: z.enum(['FREE_BETA', 'SUBSCRIPTION']).optional(),
    monthlyPrice: z.number().int().nonnegative().optional(),
    // 공개(true)/준비중(false) — 신규 고객 노출·구독 가능 여부
    released: z.boolean().optional(),
  })
  .refine(
    (v) => v.pricingMode !== undefined || v.monthlyPrice !== undefined || v.released !== undefined,
    { message: 'pricingMode·monthlyPrice·released 중 하나는 필요합니다' }
  )

// PATCH /api/admin/billing/products/[deckId] — deck 과금 모드/가격/공개 여부 변경
// scripts/billing-admin.mjs pricing/price 명령을 그대로 이식.
// paidActivatedAt: SUBSCRIPTION 전환 시 COALESCE(기존값, now()), FREE_BETA 복귀 시 값 보존(null로 지우지 않음).
// CLI의 CASE WHEN ... ELSE "paidActivatedAt" END 그대로 — 값을 지우면 재전환 시 유예 14일이 재시작되어 버림.
export async function PATCH(request: Request, { params }: { params: Promise<{ deckId: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { deckId } = await params

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청입니다', 400)
  const { pricingMode, monthlyPrice, released } = parsed.data

  const before = await prisma.billingDeckProduct.findUnique({ where: { id: deckId } })
  if (!before) return errorResponse(`deck ${deckId}를 찾을 수 없습니다`, 404)

  // 판매 상품이 0개가 되면 PG 심사·마케팅 요금 페이지가 깨진다 — 마지막 공개 업무는 내리지 못한다
  if (released === false && before.released && before.isActive) {
    const releasedCount = await prisma.billingDeckProduct.count({
      where: { released: true, isActive: true },
    })
    if (releasedCount <= 1) {
      return errorResponse('공개 업무가 최소 1개는 있어야 합니다', 409)
    }
  }

  const data: Prisma.BillingDeckProductUpdateInput = {}
  if (pricingMode !== undefined) {
    data.pricingMode = pricingMode
    if (pricingMode === 'SUBSCRIPTION') {
      data.paidActivatedAt = before.paidActivatedAt ?? new Date()
    }
    // FREE_BETA 복귀 시 paidActivatedAt은 건드리지 않는다 (CLI와 동일 — 유예 재시작 방지)
  }
  if (monthlyPrice !== undefined) {
    data.monthlyPrice = monthlyPrice
  }
  if (released !== undefined) {
    data.released = released
  }

  const updated = await prisma.billingDeckProduct.update({ where: { id: deckId }, data })

  await writeAuditLog(auth.user.id, 'billing.product.update', 'billingDeckProduct', deckId, {
    before,
    after: updated,
  })

  // 마케팅(정적 생성) 페이지의 준비중 배지·가격 노출을 다시 만든다
  if (released !== undefined && released !== before.released) invalidateDeckReleaseCache()

  return NextResponse.json({ product: updated })
}
