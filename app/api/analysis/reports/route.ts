// GET /api/analysis/reports — 분석 리포트 목록 조회

import { NextResponse } from 'next/server'
import { resolveWorkspace } from '@/lib/api-helpers'
import { queryReports } from '@/lib/coupang-ads/queries'

export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  return NextResponse.json(await queryReports(workspace.id))
}
