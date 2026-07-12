/**
 * GET /api/finance/transactions
 * 확정 거래(FinTransaction) 목록 — 계좌/계정과목/기간/방향/상태/검색어 필터 + 합계.
 *
 * query: accountId?, categoryId?, from?(YYYY-MM-DD), to?, direction?(IN|OUT),
 *        classStatus?(CLASSIFIED|REVIEW|UNCLASSIFIED), q?, take?, skip?,
 *        sort?(txnDate|amount|balanceAfter|account|category|classStatus|description), order?(asc|desc)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { toNum, toNumOrNull } from '@/lib/finance/serialize'
import type { Prisma } from '@/generated/prisma/client'

/** 컬럼명 정렬 파라미터 → Prisma orderBy(비-일자 컬럼엔 txnDate desc 타이브레이크). */
function buildOrderBy(
  sort: string | null,
  order: 'asc' | 'desc'
): Prisma.FinTransactionOrderByWithRelationInput[] {
  const tie: Prisma.FinTransactionOrderByWithRelationInput = { txnDate: 'desc' }
  switch (sort) {
    case 'amount':
      return [{ amount: order }, tie]
    case 'balanceAfter':
      return [{ balanceAfter: order }, tie]
    case 'account':
      return [{ account: { name: order } }, tie]
    case 'category':
      return [{ category: { name: order } }, tie]
    case 'classStatus':
      return [{ classStatus: order }, tie]
    case 'description':
      return [{ description: order }, tie]
    default:
      return [{ txnDate: order }]
  }
}

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
  const order: 'asc' | 'desc' = sp.get('order') === 'asc' ? 'asc' : 'desc'
  const orderBy = buildOrderBy(sp.get('sort'), order)

  // 계정과목 필터(현금흐름 상세 → 행 클릭):
  //  - categoryIds: 콤마 구분 다중(대분류 클릭 시 그 하위 리프 id들). 정확 일치 in.
  //  - uncategorized=1: 미분류(categoryId null).
  //  - 둘 다 있으면(leaf 모드 서브그룹에 미분류 리프 혼합) OR로 결합.
  //  - categoryId(단일, 정확): 기존 전체 거래 탭 하위호환.
  const categoryIds = sp.get('categoryIds')?.split(',').filter(Boolean) ?? []
  const wantUncat = sp.get('uncategorized') === '1'
  const singleCat = sp.get('categoryId')

  const where: Prisma.FinTransactionWhereInput = {
    spaceId,
    ...(sp.get('accountId') ? { accountId: sp.get('accountId')! } : {}),
    ...(direction === 'IN' || direction === 'OUT' ? { direction } : {}),
    ...(sp.get('excludeTransfer') === '1' ? { isTransfer: false } : {}),
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
  }

  // 계정과목 조건 구성.
  if (categoryIds.length && wantUncat) {
    where.OR = [{ categoryId: { in: categoryIds } }, { categoryId: null }]
  } else if (categoryIds.length) {
    where.categoryId = { in: categoryIds }
  } else if (wantUncat) {
    where.categoryId = null
  } else if (singleCat) {
    where.categoryId = singleCat
  }

  // 적요/가맹점 검색 — 위 계정과목 OR와 키 충돌 방지 위해 OR 병존 시 AND로 감쌈.
  if (q) {
    const qOr: Prisma.FinTransactionWhereInput[] = [
      { description: { contains: q, mode: 'insensitive' } },
      { counterparty: { contains: q, mode: 'insensitive' } },
    ]
    if (where.OR) {
      where.AND = [{ OR: where.OR }, { OR: qOr }]
      delete where.OR
    } else {
      where.OR = qOr
    }
  }

  // 요약 집계(incomeTotal/expenseTotal)는 이체를 제외한다 — 대시보드·현금흐름과 정의 일치.
  // 행 목록(where)은 변경 없이 이체 행을 계속 표시하며, excludeTransfer=1 파라미터로 별도 제어.
  const sumWhere = { ...where, isTransfer: false }

  const [rows, total, sums] = await Promise.all([
    prisma.finTransaction.findMany({
      where,
      orderBy,
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
        memo: true,
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
      where: sumWhere,
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
