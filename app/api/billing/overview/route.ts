import { NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveEntitlement } from '@/lib/billing/entitlement'
import { effectivePrice } from '@/lib/billing/pricing'

// GET /api/billing/overview — 구독 업무 관리 페이지 데이터 (ADMIN 이상 조회)
export async function GET() {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError

  const spaceId = resolved.space.id
  const [products, subscription, method, charges, entitlement, deckItems] = await Promise.all([
    prisma.billingDeckProduct.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'desc' },
    }),
    prisma.spaceSubscription.findUnique({
      where: { spaceId },
      include: {
        items: {
          where: { status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } },
          orderBy: { addedAt: 'asc' },
        },
      },
    }),
    prisma.billingMethod.findFirst({
      where: { spaceId, isDefault: true },
      select: { id: true, provider: true, cardSummary: true, createdAt: true },
    }),
    prisma.billingCharge.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: {
        id: true,
        orderId: true,
        amount: true,
        supplyAmount: true,
        vatAmount: true,
        status: true,
        failReason: true,
        periodStart: true,
        periodEnd: true,
        breakdown: true,
        createdAt: true,
      },
    }),
    resolveEntitlement(spaceId),
    // ENDED 포함 — 이전 고객 보장가(lockedPrice)는 ENDED 아이템에 남아 있다
    prisma.subscriptionItem.findMany({
      where: { subscription: { spaceId }, type: 'DECK' },
      select: { deckAppId: true, status: true, priceSnapshot: true, lockedPrice: true },
    }),
  ])

  // 이 Space 에 실제 청구될 월 공급가: 구독 중이면 청구 기준(priceSnapshot), 아니면 보장가 적용가
  const effectivePrices = new Map(deckItems.map((i) => [i.deckAppId, i] as const))
  const productsWithPrice = products.map((p) => {
    const item = effectivePrices.get(p.id)
    const billed =
      item &&
      item.status !== 'ENDED' &&
      (subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE')
    return {
      ...p,
      effectivePrice: billed
        ? item.priceSnapshot
        : effectivePrice(item?.lockedPrice, p.monthlyPrice),
    }
  })

  return NextResponse.json({
    role: resolved.role,
    products: productsWithPrice,
    subscription,
    method,
    charges,
    entitlement,
  })
}
