/**
 * POST /api/finance/staging/commit
 * DRAFT 임포트의 스테이징 행을 확정 거래(FinTransaction)로 반영한다.
 *   - resolution NEW / DUP_CHANGED → upsert(신규 삽입 / 변경 반영)
 *   - resolution DUP_SAME          → 건너뜀
 * 반영 후 임포트를 COMMITTED 로 표시하고 계좌 월말 잔고 스냅샷을 파생한다.
 *
 * body: { importId }
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

/** Date → "YYYY-MM" (로컬). */
function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => ({}))
  const importId = typeof body?.importId === 'string' ? body.importId : ''
  if (!importId) return errorResponse('importId가 필요합니다', 400)

  const importRow = await prisma.finImport.findFirst({
    where: { id: importId, spaceId },
    select: { id: true, accountId: true, status: true },
  })
  if (!importRow) return errorResponse('임포트를 찾을 수 없습니다', 404)
  if (importRow.status === 'COMMITTED') return errorResponse('이미 반영된 임포트입니다', 409)

  const staged = await prisma.finStagedRow.findMany({
    where: { importId, spaceId },
    select: {
      id: true,
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

  const accountId = importRow.accountId

  // 재임포트 시 사용자 분류 보존 — 이미 분류된(categoryId 존재) 거래는 자동분류로 덮어쓰지 않는다.
  // DUP_CHANGED 행은 콘텐츠(적요/금액/잔액 등)만 갱신하고 계정과목/상태는 기존 값을 유지한다.
  const commitKeys = staged.filter((s) => s.resolution !== 'DUP_SAME').map((s) => s.identityKey)
  const existingTxns =
    commitKeys.length > 0
      ? await prisma.finTransaction.findMany({
          where: { spaceId, accountId, identityKey: { in: commitKeys } },
          select: { identityKey: true, categoryId: true },
        })
      : []
  const classifiedKeys = new Set(
    existingTxns.filter((t) => t.categoryId != null).map((t) => t.identityKey)
  )

  let committed = 0
  let skipped = 0

  await prisma.$transaction(
    async (tx) => {
      for (const s of staged) {
        if (s.resolution === 'DUP_SAME') {
          skipped++
          continue
        }
        const isTransfer = s.categoryId ? transferIds.has(s.categoryId) : false
        // 변경 가능 콘텐츠 필드 — 신규/재임포트 모두 항상 갱신
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
          importId,
        }
        // 분류 필드 — 신규이거나 기존 거래가 미분류일 때만 반영(사용자 정정 보호)
        const classification = {
          categoryId: s.categoryId,
          classStatus: s.classStatus,
          matchedRuleId: s.matchedRuleId,
          isTransfer,
        }
        const preserve = classifiedKeys.has(s.identityKey)
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
        committed++
      }

      await tx.finImport.update({
        where: { id: importId },
        data: { status: 'COMMITTED', committedRows: committed },
      })

      // 잔고 스냅샷 파생 — 계좌의 월별 마지막 거래후잔액(은행만, 카드는 balanceAfter 없음)
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
    },
    { timeout: 30000, maxWait: 10000 }
  )

  return NextResponse.json({ importId, committed, skipped })
}
