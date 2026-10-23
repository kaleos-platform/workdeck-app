/**
 * GET /api/finance/balance-trend
 * 월말 현금·부채·순자산 추이(이번 달까지) — 잔액 추이 페이지.
 *
 * query: range?(6|12|all, 기본 12)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { queryBalanceTrend } from '@/lib/finance/queries'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error

  const raw = req.nextUrl.searchParams.get('range')
  const range = raw === 'all' ? 'all' : raw === '6' ? 6 : 12
  return NextResponse.json(await queryBalanceTrend(resolved.space.id, range))
}
