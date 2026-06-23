/**
 * GET /api/finance/staging
 * 거래 내역 화면의 확인·처리 대기열 — DRAFT 임포트의 스테이징 행을 탭/계좌 필터로 조회 + 탭별 카운트.
 *
 * query: importId?(특정 임포트), accountId?, tab?(all|unclassified|review|dup|classified), take?, skip?
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'
import type { Prisma } from '@/generated/prisma/client'

const DUP = ['DUP_SAME', 'DUP_CHANGED'] as const

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const importId = sp.get('importId') ?? undefined
  const accountId = sp.get('accountId') ?? undefined
  const tab = sp.get('tab') ?? 'all'
  const take = Math.min(500, Math.max(1, Number(sp.get('take') ?? 200)))
  const skip = Math.max(0, Number(sp.get('skip') ?? 0))

  // 기본 스코프: DRAFT 임포트의 스테이징 행
  const base: Prisma.FinStagedRowWhereInput = {
    spaceId,
    import: { status: 'DRAFT' },
    ...(importId ? { importId } : {}),
    ...(accountId ? { accountId } : {}),
  }

  const tabWhere: Prisma.FinStagedRowWhereInput = (() => {
    switch (tab) {
      case 'unclassified':
        return { classStatus: 'UNCLASSIFIED' }
      case 'review':
        return { classStatus: 'REVIEW' }
      case 'dup':
        return { resolution: { in: [...DUP] } }
      case 'classified':
        return { classStatus: 'CLASSIFIED' }
      default:
        return {}
    }
  })()

  const [rows, total, unclassified, review, dup, classified] = await Promise.all([
    prisma.finStagedRow.findMany({
      where: { ...base, ...tabWhere },
      orderBy: { txnDate: 'asc' },
      take,
      skip,
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
        classStatus: true,
        resolution: true,
        matchedRuleId: true,
        categoryId: true,
        category: { select: { id: true, name: true, parent: { select: { name: true } } } },
        account: { select: { id: true, name: true, kind: true } },
      },
    }),
    prisma.finStagedRow.count({ where: base }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'UNCLASSIFIED' } }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'REVIEW' } }),
    prisma.finStagedRow.count({ where: { ...base, resolution: { in: [...DUP] } } }),
    prisma.finStagedRow.count({ where: { ...base, classStatus: 'CLASSIFIED' } }),
  ])

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      amount: toNum(r.amount),
      balanceAfter: toNumOrNull(r.balanceAfter),
    })),
    counts: { total, unclassified, review, dup, classified },
  })
}
