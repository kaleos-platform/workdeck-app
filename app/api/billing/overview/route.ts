import { NextResponse } from 'next/server'
import { resolveSpaceContext, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { resolveEntitlement } from '@/lib/billing/entitlement'

// GET /api/billing/overview — 구독 관리 페이지 데이터 (ADMIN 이상 조회)
export async function GET() {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error
  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError

  const spaceId = resolved.space.id
  const [products, subscription, method, charges, entitlement] = await Promise.all([
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
  ])

  return NextResponse.json({
    role: resolved.role,
    products,
    subscription,
    method,
    charges,
    entitlement,
  })
}
