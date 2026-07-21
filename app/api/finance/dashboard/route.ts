/**
 * GET /api/finance/dashboard
 * 요약 대시보드 집계 — KPI(총현금/수입/지출/순현금흐름 + 전기 대비), 12개월 추이,
 * 계좌별 잔고 스냅샷, 계정과목별 지출 Top, 부채 현황.
 *
 * query: period?(month|quarter|year, 기본 month), anchor?(month=YYYY-MM, quarter=YYYY-Qn, year=YYYY; 기본 현재)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { queryDashboard } from '@/lib/finance/queries'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  // 콜드케이스(활성인데 계정과목 0) 자가복구
  await ensureFinanceSeeded(spaceId)

  const sp = req.nextUrl.searchParams
  const rawPeriod = sp.get('period')
  const period = rawPeriod === 'year' ? 'year' : rawPeriod === 'quarter' ? 'quarter' : 'month'

  return NextResponse.json(await queryDashboard(spaceId, { period, anchor: sp.get('anchor') }))
}
