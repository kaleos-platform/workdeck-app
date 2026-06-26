/**
 * POST /api/finance/staging/commit
 * 분류완료(CLASSIFIED) 스테이징 행만 확정 거래(FinTransaction)로 저장한다(임포트 무관·행 단위).
 *   - 대상: classStatus=CLASSIFIED && resolution!=DUP_SAME (isStagedRowCommittable)
 *   - 미분류·검토·DUP_SAME 행은 보류(큐에 남김).
 *   - 커밋된 staged 행은 delete(확정 거래가 source of truth). 임포트 status는 건드리지 않는다.
 *   - 영향 계좌별 월말 잔고 스냅샷 파생.
 *
 * body: { importId? }  // 주면 해당 임포트로 한정, 없으면 space 전체 DRAFT의 분류완료 행
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

/** Date → "YYYY-MM" (로컬). */
function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const importId = typeof body?.importId === 'string' && body.importId ? body.importId : undefined

  // 대상: DRAFT 임포트의 분류완료(비-DUP_SAME) 행. (isStagedRowCommittable 술어와 동치)
  const where: Prisma.FinStagedRowWhereInput = {
    spaceId,
    import: { status: 'DRAFT' },
    classStatus: 'CLASSIFIED',
    resolution: { not: 'DUP_SAME' },
    ...(importId ? { importId } : {}),
  }

  const staged = await prisma.finStagedRow.findMany({
    where,
    select: {
      id: true,
      importId: true,
      accountId: true,
      txnDate: true,
      direction: true,
      amount: true,
      balanceAfter: true,
      description: true,
      counterparty: true,
      approvalNo: true,
      cancelFlag: true,
      categoryId: true,
      classStatus: true,
      matchedRuleId: true,
      identityKey: true,
      contentHash: true,
      resolution: true,
    },
  })

  if (staged.length === 0) return NextResponse.json({ committed: 0 })

  // TRANSFER 계정과목은 isTransfer=true (수입/지출 집계 제외)
  const categoryIds = [...new Set(staged.map((s) => s.categoryId).filter((v): v is string => !!v))]
  const transferIds = new Set(
    categoryIds.length > 0
      ? (
          await prisma.finCategory.findMany({
            where: { spaceId, id: { in: categoryIds }, type: 'TRANSFER' },
            select: { id: true },
          })
        ).map((c) => c.id)
      : []
  )

  // 재임포트 시 사용자 분류 보존 — 이미 분류된 기존 거래는 자동분류로 덮어쓰지 않는다.
  // 행이 여러 계좌에 걸칠 수 있으므로 (accountId, identityKey) 조합으로 조회/판정한다.
  const identityKeys = [...new Set(staged.map((s) => s.identityKey))]
  const existingTxns = await prisma.finTransaction.findMany({
    where: { spaceId, identityKey: { in: identityKeys } },
    select: { accountId: true, identityKey: true, categoryId: true },
  })
  const classifiedKeys = new Set(
    existingTxns.filter((t) => t.categoryId != null).map((t) => `${t.accountId}|${t.identityKey}`)
  )

  const affectedAccounts = [...new Set(staged.map((s) => s.accountId))]
  let committed = 0

  await prisma.$transaction(
    async (tx) => {
      for (const s of staged) {
        const isTransfer = s.categoryId ? transferIds.has(s.categoryId) : false
        const content = {
          txnDate: s.txnDate,
          direction: s.direction,
          amount: s.amount,
          balanceAfter: s.balanceAfter,
          description: s.description,
          counterparty: s.counterparty,
          approvalNo: s.approvalNo,
          cancelFlag: s.cancelFlag,
          contentHash: s.contentHash,
          importId: s.importId,
        }
        const classification = {
          categoryId: s.categoryId,
          classStatus: s.classStatus,
          matchedRuleId: s.matchedRuleId,
          isTransfer,
        }
        const preserve = classifiedKeys.has(`${s.accountId}|${s.identityKey}`)
        await tx.finTransaction.upsert({
          where: {
            spaceId_accountId_identityKey: {
              spaceId,
              accountId: s.accountId,
              identityKey: s.identityKey,
            },
          },
          update: preserve ? content : { ...content, ...classification },
          create: {
            spaceId,
            accountId: s.accountId,
            identityKey: s.identityKey,
            ...content,
            ...classification,
          },
        })
        // 큐에서 제거 — 확정 거래가 source of truth
        await tx.finStagedRow.delete({ where: { id: s.id } })
        committed++
      }

      // 영향 계좌별 월말 잔고 스냅샷(은행만 balanceAfter 존재)
      for (const accountId of affectedAccounts) {
        const withBalance = await tx.finTransaction.findMany({
          where: { spaceId, accountId, balanceAfter: { not: null } },
          select: { txnDate: true, balanceAfter: true },
          orderBy: { txnDate: 'asc' },
        })
        const lastByMonth = new Map<string, (typeof withBalance)[number]['balanceAfter']>()
        for (const t of withBalance) lastByMonth.set(yearMonth(t.txnDate), t.balanceAfter)
        for (const [ym, balance] of lastByMonth) {
          if (balance == null) continue
          await tx.finBalanceSnapshot.upsert({
            where: { spaceId_accountId_yearMonth: { spaceId, accountId, yearMonth: ym } },
            update: { balance, source: 'DERIVED' },
            create: { spaceId, accountId, yearMonth: ym, balance, source: 'DERIVED' },
          })
        }
      }
    },
    { timeout: 30000, maxWait: 10000 }
  )

  return NextResponse.json({ committed })
}
