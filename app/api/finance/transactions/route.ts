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
import { queryTransactions } from '@/lib/finance/queries'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const sp = req.nextUrl.searchParams
  const take = Math.min(500, Math.max(1, Number(sp.get('take') ?? 100)))
  const skip = Math.max(0, Number(sp.get('skip') ?? 0))
  const order: 'asc' | 'desc' = sp.get('order') === 'asc' ? 'asc' : 'desc'

  return NextResponse.json(
    await queryTransactions(spaceId, {
      accountId: sp.get('accountId'),
      from: sp.get('from'),
      to: sp.get('to'),
      direction: sp.get('direction'),
      classStatus: sp.get('classStatus'),
      categoryIds: sp.get('categoryIds')?.split(',').filter(Boolean) ?? [],
      uncategorized: sp.get('uncategorized') === '1',
      categoryId: sp.get('categoryId'),
      expandCategory: sp.get('expandCategory') === '1',
      excludeTransfer: sp.get('excludeTransfer') === '1',
      q: sp.get('q'),
      take,
      skip,
      sort: sp.get('sort'),
      order,
    })
  )
}
