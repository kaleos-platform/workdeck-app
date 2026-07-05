/**
 * GET /api/finance/transactions
 * 확정 거래(FinTransaction) 목록 — 계좌/계정과목/기간/방향/상태/검색어 필터 + 합계.
 *
 * query: accountId?, categoryId?, from?(YYYY-MM-DD), to?, direction?(IN|OUT),
 *        classStatus?(CLASSIFIED|REVIEW|UNCLASSIFIED), q?, take?, skip?
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'
import type { Prisma } from '@/generated/prisma/client'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const take = Math.min(500, Math.max(1, Number(sp.get('take') ?? 100)))
  const skip = Math.max(0, Number(sp.get('skip') ?? 0))

  const from = sp.get('from')
  const to = sp.get('to')
  const direction = sp.get('direction')
  const classStatus = sp.get('classStatus')
  const q = sp.get('q')?.trim()

  const where: Prisma.FinTransactionWhereInput = {
    spaceId,
    ...(sp.get('accountId') ? { accountId: sp.get('accountId')! } : {}),
    ...(sp.get('categoryId') ? { categoryId: sp.get('categoryId')! } : {}),
    ...(direction === 'IN' || direction === 'OUT' ? { direction } : {}),
    ...(classStatus === 'CLASSIFIED' || classStatus === 'REVIEW' || classStatus === 'UNCLASSIFIED'
      ? { classStatus }
      : {}),
    ...(from || to
      ? {
          txnDate: {
            // 로컬 자정 경계 — 대시보드/집계(aggregate.ts)의 로컬 월 경계와 시간대 일치
            ...(from ? { gte: new Date(`${from}T00:00:00`) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: 'insensitive' } },
            { counterparty: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [rows, total, sums] = await Promise.all([
    prisma.finTransaction.findMany({
      where,
      orderBy: { txnDate: 'desc' },
      take,
      skip,
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
        isTransfer: true,
        classStatus: true,
        matchedRuleId: true,
        categoryId: true,
        liabilityId: true,
        category: {
          select: { id: true, name: true, type: true, parent: { select: { name: true } } },
        },
        liability: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, kind: true } },
      },
    }),
    prisma.finTransaction.count({ where }),
    prisma.finTransaction.groupBy({
      by: ['direction'],
      where,
      _sum: { amount: true },
    }),
  ])

  const incomeTotal = toNum(sums.find((s) => s.direction === 'IN')?._sum.amount)
  const expenseTotal = toNum(sums.find((s) => s.direction === 'OUT')?._sum.amount)

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      amount: toNum(r.amount),
      balanceAfter: toNumOrNull(r.balanceAfter),
    })),
    total,
    summary: { incomeTotal, expenseTotal, net: incomeTotal - expenseTotal },
  })
}
