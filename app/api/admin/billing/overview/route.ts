import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'

// GET /api/admin/billing/overview — deck 과금 모드, 구독 현황, 최근 청구 요약
// scripts/billing-admin.mjs `status` 명령의 3개 쿼리를 Prisma로 이식
export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const [products, subscriptions, recentCharges, statusCounts] = await Promise.all([
    prisma.billingDeckProduct.findMany({
      orderBy: { monthlyPrice: 'desc' },
    }),
    prisma.spaceSubscription.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        space: { select: { id: true, name: true } },
        items: {
          where: { status: { in: ['ACTIVE', 'CANCEL_AT_PERIOD_END'] } },
          select: { deckAppId: true, status: true },
        },
      },
    }),
    prisma.billingCharge.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { space: { select: { id: true, name: true } } },
    }),
    prisma.spaceSubscription.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ])

  const exemptCount = await prisma.spaceSubscription.count({ where: { exemptFlag: true } })

  const summary = {
    byStatus: Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])),
    exempt: exemptCount,
  }

  return NextResponse.json({ products, subscriptions, recentCharges, summary })
}
