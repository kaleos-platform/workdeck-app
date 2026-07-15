/**
 * GET /api/finance/cashflow
 * 현금흐름 상세(테이블 우선) — 기간 컬럼별 수입/지출을 리프(운영 항목) 단위로 집계(+ 상위 대분류 메타).
 * 수입 섹션 / 지출 섹션 / 순현금흐름 + 직전 기간 대비 증감%.
 *
 * query: grain?(month|quarter|year, 기본 month),
 *        periods?(콤마 구분 버킷키, 예 2026-01,2026-06 — 비연속 다중선택 가능. 없으면 직전월까지 기본 N개)
 */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { ensureFinanceSeeded } from '@/lib/finance/kifrs-seed'
import { queryCashflow } from '@/lib/finance/queries'
import type { Grain } from '@/lib/finance/periods'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('finance')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  // 콜드케이스(활성인데 계정과목 0) 자가복구
  await ensureFinanceSeeded(spaceId)

  const sp = req.nextUrl.searchParams
  const grain: Grain =
    sp.get('grain') === 'quarter' ? 'quarter' : sp.get('grain') === 'year' ? 'year' : 'month'
  const periods = sp.get('periods')?.split(',') ?? []
  const exclude = sp.get('exclude')?.split(',').filter(Boolean) ?? []

  return NextResponse.json(await queryCashflow(spaceId, { grain, periods, exclude }))
}
