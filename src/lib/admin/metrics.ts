/**
 * 운영 어드민 대시보드 지표 — 전부 Prisma count/groupBy/aggregate로 해결(Supabase 페이지네이션 호출 없음).
 * VAT 주의: BillingCharge.amount는 VAT 포함, priceSnapshot/monthlyPrice는 공급가.
 * MRR/ARR은 공급가를 primary로 반환하고 VAT 포함액은 calcAmounts()로 파생한다(직접 ×1.1 금지).
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { calcAmounts } from '@/lib/billing/pricing'

export interface AdminMetrics {
  newUsers7d: number
  totalUsers: number
  // 유료 결제 이력(PAID BillingCharge 1건 이상)이 있는 Space에 현재 소속된 사용자 distinct 수. 탈퇴자는 제외됨.
  paidUsersCumulative: number
  // 현재 구독 ACTIVE && 면제 아님인 Space에 소속된 사용자 distinct 수.
  paidUsersCurrent: number
  // 최근 7일 PAID 청구 합 — VAT 포함액(BillingCharge.amount 원본).
  newRevenue7dAmount: number
  mrr: {
    actualSupply: number // 공급가
    actualAmount: number // VAT 포함
    potentialSupply: number // 활성 deck 전부 과금 시(면제 포함) 공급가
    potentialAmount: number // VAT 포함
  }
  arr: {
    actualSupply: number
    actualAmount: number
    potentialSupply: number
    potentialAmount: number
  }
}

export async function getAdminMetrics(): Promise<AdminMetrics> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const [
    newUsers7d,
    totalUsers,
    newRevenue7d,
    activeMrrAgg,
    activeDeckCounts,
    currentPaidSubs,
  ] = await Promise.all([
    prisma.user.count({ where: { createdAt: { gte: since7d } } }),
    prisma.user.count(),
    prisma.billingCharge.aggregate({
      _sum: { amount: true },
      where: { status: 'PAID', createdAt: { gte: since7d } },
    }),
    // 실제 MRR: 현재 ACTIVE 구독(면제 아님)의 ACTIVE 아이템 공급가 합. CANCEL_AT_PERIOD_END는 제외.
    prisma.subscriptionItem.aggregate({
      _sum: { priceSnapshot: true },
      where: {
        status: 'ACTIVE',
        subscription: { status: 'ACTIVE', exemptFlag: false },
      },
    }),
    // 잠재 MRR: 활성 deck 인스턴스 수 — pricingMode 필터 없음(전 deck FREE_BETA라 상수 0 방지).
    prisma.deckInstance.groupBy({
      by: ['deckAppId'],
      where: { isActive: true },
      _count: { _all: true },
    }),
    // 현재 유료 사용자: 구독 ACTIVE && 면제 아님인 Space
    prisma.spaceSubscription.findMany({
      where: { status: 'ACTIVE', exemptFlag: false },
      select: { spaceId: true },
    }),
  ])

  // 누적 유료 사용자 — PAID 이력 있는 Space → 멤버 distinct (순차 의존, 확인 결과 in: [] 은 0행 정상 반환)
  const paidSpaces = await prisma.billingCharge.groupBy({
    by: ['spaceId'],
    where: { status: 'PAID' },
  })
  const paidMembers = await prisma.spaceMember.groupBy({
    by: ['userId'],
    where: { spaceId: { in: paidSpaces.map((s) => s.spaceId) } },
  })

  const currentPaidMembers = await prisma.spaceMember.groupBy({
    by: ['userId'],
    where: { spaceId: { in: currentPaidSubs.map((s) => s.spaceId) } },
  })

  const activeProducts = await prisma.billingDeckProduct.findMany({
    where: { isActive: true, monthlyPrice: { gt: 0 } },
    select: { id: true, monthlyPrice: true },
  })
  const deckCountById = new Map(activeDeckCounts.map((d) => [d.deckAppId, d._count._all]))
  const potentialMrrSupply = activeProducts.reduce(
    (acc, p) => acc + p.monthlyPrice * (deckCountById.get(p.id) ?? 0),
    0
  )

  const actualMrrSupply = activeMrrAgg._sum.priceSnapshot ?? 0
  const actualMrr = calcAmounts(actualMrrSupply)
  const potentialMrr = calcAmounts(potentialMrrSupply)

  return {
    newUsers7d,
    totalUsers,
    paidUsersCumulative: paidMembers.length,
    paidUsersCurrent: currentPaidMembers.length,
    newRevenue7dAmount: newRevenue7d._sum.amount ?? 0,
    mrr: {
      actualSupply: actualMrr.supplyAmount,
      actualAmount: actualMrr.amount,
      potentialSupply: potentialMrr.supplyAmount,
      potentialAmount: potentialMrr.amount,
    },
    arr: {
      actualSupply: actualMrr.supplyAmount * 12,
      actualAmount: actualMrr.amount * 12,
      potentialSupply: potentialMrr.supplyAmount * 12,
      potentialAmount: potentialMrr.amount * 12,
    },
  }
}
