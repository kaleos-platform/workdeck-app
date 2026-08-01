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
      select: { txnDate: true, balanceAfter: true },
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
