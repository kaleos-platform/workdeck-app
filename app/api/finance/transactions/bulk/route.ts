/**
 * POST /api/finance/transactions/bulk
 * 선택한 확정 거래(FinTransaction)들을 일괄 처리한다.
 *   - { ids, categoryId }         → 일괄 계정과목 분류(CLASSIFIED, isTransfer 반영, 자동 학습 안 함)
 *   - { ids, liabilityId }        → 일괄 부채 상환 연결(문자열=연결, null=연결 해제)
 *   - { ids, action: 'delete' }   → 일괄 삭제 + 영향 계좌의 DERIVED 월말 스냅샷 재계산(MANUAL 보존)
 * 보안: 서버에서 spaceId 스코프로만 처리(클라이언트 id 신뢰 안 함).
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deriveMonthEndSnapshots } from '@/lib/finance/snapshots'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: unknown): x is string => typeof x === 'string')
    : []
  if (ids.length === 0) return errorResponse('대상 거래가 없습니다', 400)

  // ── 삭제 ──
  if (body?.action === 'delete') {
    // 삭제 대상의 영향 계좌를 먼저 파악(스냅샷 재계산 범위).
    const targets = await prisma.finTransaction.findMany({
      where: { id: { in: ids }, spaceId },
      select: { accountId: true },
    })
    const affectedAccounts = [...new Set(targets.map((t) => t.accountId))]

    let deleted = 0
    await prisma.$transaction(
      async (tx) => {
        const res = await tx.finTransaction.deleteMany({ where: { id: { in: ids }, spaceId } })
        deleted = res.count

        for (const accountId of affectedAccounts) {
          // 파생 스냅샷만 비우고 남은 거래로 재계산 — 사용자 수기 입력(MANUAL)은 보존.
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
      },
      { timeout: 30000, maxWait: 10000 }
    )

    return NextResponse.json({ deleted })
  }

  // ── 일괄 분류 ──
  if (typeof body?.categoryId === 'string' && body.categoryId) {
    const category = await prisma.finCategory.findFirst({
      where: { id: body.categoryId, spaceId },
      select: { id: true, type: true },
    })
    if (!category) return errorResponse('계정과목을 찾을 수 없습니다', 400)

    const result = await prisma.finTransaction.updateMany({
      where: { id: { in: ids }, spaceId },
      data: {
        categoryId: category.id,
        classStatus: 'CLASSIFIED',
        isTransfer: category.type === 'TRANSFER',
        // 일괄 분류는 규칙 학습을 하지 않으므로 기존 규칙 힌트를 정리한다.
        matchedRuleId: null,
      },
    })
    return NextResponse.json({ updated: result.count })
  }

  // ── 일괄 부채 상환 연결/해제 ──
  if ('liabilityId' in body) {
    let targetLiabilityId: string | null
    if (body.liabilityId === null || body.liabilityId === '') {
      targetLiabilityId = null
    } else if (typeof body.liabilityId === 'string') {
      const liability = await prisma.finLiability.findFirst({
        where: { id: body.liabilityId, spaceId },
        select: { id: true },
      })
      if (!liability) return errorResponse('부채를 찾을 수 없습니다', 400)
      targetLiabilityId = liability.id
    } else {
      return errorResponse('liabilityId 형식이 올바르지 않습니다', 400)
    }

    const result = await prisma.finTransaction.updateMany({
      where: { id: { in: ids }, spaceId },
      data: { liabilityId: targetLiabilityId },
    })
    return NextResponse.json({ updated: result.count })
  }

  return errorResponse('처리할 내용이 없습니다', 400)
}
