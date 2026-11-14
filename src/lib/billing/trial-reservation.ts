// 체험 중 구독 예약 공통 규칙 — 구독 서비스·환불 웹훅이 함께 쓴다.
// 예약 아이템(awaitingTrialEnd)의 유료 시작일은 저장하지 않고 업무별 체험 종료일에서 파생한다.
// 체험 종료일은 어드민 API·billing-admin SQL(set-trial·trial-all) 등 여러 경로로 바뀌므로
// 날짜를 복사해 두면 연장 시 체험 중에 결제된다.
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

export type DbClient = Prisma.TransactionClient | typeof prisma

export async function loadTrialEnds(db: DbClient, spaceId: string): Promise<Map<string, Date>> {
  const rows = await db.spaceDeckAccess.findMany({
    where: { spaceId, trialEndsAt: { not: null } },
    select: { deckAppId: true, trialEndsAt: true },
  })
  return new Map(rows.map((r) => [r.deckAppId, r.trialEndsAt!]))
}

// 체험이 끝난 뒤에도 실제 종료일로 고정한다 — now 로 흐르면 분류·orderId 가 날마다 바뀐다.
export function reservedStart(
  item: { deckAppId: string; addedAt: Date },
  trialEnds: Map<string, Date>
): Date {
  return trialEnds.get(item.deckAppId) ?? item.addedAt
}

export function hasPaidItems(items: Array<{ status: string; awaitingTrialEnd: boolean }>) {
  return items.some((i) => i.status !== 'ENDED' && !i.awaitingTrialEnd)
}

// 결제된 아이템 없이 예약만 남은 구독은 결제일을 남은 예약의 가장 빠른 시작일로 맞추고,
// 남은 아이템이 없으면 구독을 끝낸다. 예약 취소·환불·예약 결제 소진 뒤 같은 트랜잭션에서 호출한다.
export async function realignReservationOnly(
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  spaceId: string
) {
  const items = await tx.subscriptionItem.findMany({
    where: { subscriptionId, status: { not: 'ENDED' } },
  })
  if (hasPaidItems(items)) return
  if (items.length === 0) {
    await tx.spaceSubscription.update({
      where: { id: subscriptionId },
      data: { status: 'CANCELED', currentPeriodEnd: null, retryCount: 0 },
    })
    return
  }
  const trialEnds = await loadTrialEnds(tx, spaceId)
  const next = new Date(Math.min(...items.map((i) => reservedStart(i, trialEnds).getTime())))
  await tx.spaceSubscription.update({
    where: { id: subscriptionId },
    data: { currentPeriodEnd: next, retryCount: 0 },
  })
}
