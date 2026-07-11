/**
 * POST /api/finance/staging/commit
 * 분류완료(CLASSIFIED) 스테이징 행만 확정 거래(FinTransaction)로 저장한다(임포트 무관·행 단위).
 *   - 대상: classStatus=CLASSIFIED && resolution!=DUP_SAME (isStagedRowCommittable)
 *   - 미분류·검토 행은 보류(큐에 남김). DUP_SAME(중복 제외) 행은 저장과 함께 정리(삭제).
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

  // 중복 제외(DUP_SAME) 행 정리 조건 — 저장 대상이 없어도 호출 시점에 함께 정리한다.
  const dupCleanupWhere: Prisma.FinStagedRowWhereInput = {
    spaceId,
    import: { status: 'DRAFT' },
    resolution: 'DUP_SAME',
    ...(importId ? { importId } : {}),
  }

  if (staged.length === 0) {
    const cleaned = await prisma.finStagedRow.deleteMany({ where: dupCleanupWhere })
    return NextResponse.json({ committed: 0, dupCleaned: cleaned.count })
  }

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

  // 계좌별 staged 행의 최소 txnDate — 스냅샷 재계산 범위 한정에 사용.
  // 불변식: 이 커밋이 건드리는 월 이전 스냅샷은 확정 거래 집합이 변하지 않으므로 불변.
  // 안전 마진: minMonth 보다 한 달 앞까지 포함(tzoffset 엣지케이스 방어).
  const minTxnDateByAccount = new Map<string, Date>()
  for (const s of staged) {
    const prev = minTxnDateByAccount.get(s.accountId)
    if (!prev || s.txnDate < prev) minTxnDateByAccount.set(s.accountId, s.txnDate)
  }

  let committed = 0
  let dupCleaned = 0
  // 커밋 성공한 staged row id를 모아 마지막에 1회 deleteMany
  const committedIds: string[] = []

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
        // 재임포트 자동분류(DUP_CHANGED 포함)가 사용자 분류를 덮어쓰지 않도록 보존.
        // 단, 사용자가 "유지"로 명시 선택한 중복(DUP_OVERWRITE)은 덮어쓰기 의도이므로 분류를 반영한다.
        const preserve =
          classifiedKeys.has(`${s.accountId}|${s.identityKey}`) && s.resolution !== 'DUP_OVERWRITE'
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
        committedIds.push(s.id)
        committed++
      }

      // 커밋된 staged 행 일괄 삭제 — 행별 delete 대신 1회 deleteMany로 쿼리 수 절감
      if (committedIds.length > 0) {
        await tx.finStagedRow.deleteMany({ where: { id: { in: committedIds } } })
      }

      // 중복 제외(DUP_SAME) 행 정리 — 저장과 함께 소멸. 동일 내용 중복이라 보존 가치 없음
      // (남겨두면 큐에 영구 잔류해 중복 탭이 계속 누적된다).
      const cleaned = await tx.finStagedRow.deleteMany({ where: dupCleanupWhere })
      dupCleaned = cleaned.count

      // 영향 계좌별 월말 잔고 스냅샷(은행만 balanceAfter 존재)
      for (const accountId of affectedAccounts) {
        // 전체 이력 대신 이번 커밋의 영향 월(minTxnDate의 월초 - 1달 안전마진) 이후만 조회.
        // 그 이전 스냅샷은 이 커밋으로 변하지 않으므로 재계산 불필요.
        const minDate = minTxnDateByAccount.get(accountId)
        const rangeStart = minDate
          ? new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth() - 1, 1))
          : undefined
        const withBalance = await tx.finTransaction.findMany({
          where: {
            spaceId,
            accountId,
            balanceAfter: { not: null },
            ...(rangeStart ? { txnDate: { gte: rangeStart } } : {}),
          },
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

        // 계좌 기준(현재) 잔액 갱신 — 최신 일자 거래후잔액을 기준잔액으로.
        // 가드: 기준일 이후 데이터일 때만(오래된 파일 재업로드가 최신 잔액을 되돌리지 않도록).
        const latest = withBalance[withBalance.length - 1]
        if (latest?.balanceAfter != null) {
          const acct = await tx.finAccount.findUnique({
            where: { id: accountId },
            select: { currentBalanceAsOf: true },
          })
          if (!acct?.currentBalanceAsOf || latest.txnDate > acct.currentBalanceAsOf) {
            await tx.finAccount.update({
              where: { id: accountId },
              data: { currentBalance: latest.balanceAfter, currentBalanceAsOf: latest.txnDate },
            })
          }
        }
      }
    },
    { timeout: 30000, maxWait: 10000 }
  )

  return NextResponse.json({ committed, dupCleaned })
}
