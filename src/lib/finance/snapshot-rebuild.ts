/**
 * DERIVED 월말 스냅샷 재계산 — FinTransaction 삭제 후 영향 계좌의 파생 스냅샷을
 * 남은 거래로 다시 만든다. 사용자 수기 입력(MANUAL)은 보존.
 * $transaction 내부에서 호출한다(tx 전달).
 */
import type { Prisma } from '@/generated/prisma/client'
import { deriveMonthEndSnapshots } from '@/lib/finance/snapshots'

export async function rebuildDerivedSnapshots(
  tx: Prisma.TransactionClient,
  spaceId: string,
  accountIds: string[]
) {
  for (const accountId of accountIds) {
    await tx.finBalanceSnapshot.deleteMany({
      where: { spaceId, accountId, source: 'DERIVED' },
    })
    const manual = await tx.finBalanceSnapshot.findMany({
      where: { spaceId, accountId, source: 'MANUAL' },
      select: { yearMonth: true },
    })
    const manualMonths = new Set(manual.map((m) => m.yearMonth))
    const remaining = await tx.finTransaction.findMany({
      where: { spaceId, accountId, balanceAfter: { not: null } },
      select: { txnDate: true, balanceAfter: true, direction: true, amount: true },
    })
    const snaps = deriveMonthEndSnapshots(remaining, manualMonths)
    if (snaps.length > 0) {
      await tx.finBalanceSnapshot.createMany({
        data: snaps.map((s) => ({
          spaceId,
          accountId,
          yearMonth: s.yearMonth,
          balance: s.balance,
          source: 'DERIVED' as const,
        })),
      })
    }
  }
}

/**
 * 부채 월말 잔액 기록 — 부채 생성·잔액 변경·삭제 시 같은 $transaction 안에서 호출.
 * 현재 잔액이 최신 진실이므로 ym 이후 스냅샷은 지우고(이월로 ym 값이 이어짐) ym 을 upsert 한다.
 * 늦게 반영한 과거 달 상환도 올바른 달부터 반영된다.
 */
export async function recordLiabilitySnapshot(
  tx: Prisma.TransactionClient,
  s: { spaceId: string; liabilityId: string; name: string; yearMonth: string; balance: number }
) {
  await tx.finLiabilitySnapshot.deleteMany({
    where: { spaceId: s.spaceId, liabilityId: s.liabilityId, yearMonth: { gt: s.yearMonth } },
  })
  await tx.finLiabilitySnapshot.upsert({
    where: {
      spaceId_liabilityId_yearMonth: {
        spaceId: s.spaceId,
        liabilityId: s.liabilityId,
        yearMonth: s.yearMonth,
      },
    },
    create: s,
    update: { name: s.name, balance: s.balance },
  })
}
