import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { listOpeningMigrationJobs } from '@/lib/admin/opening-migrations'

export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

// GET /api/admin/opening-migrations — 오프닝 자동 이전 큐(운영자 전용). 연락처 조각 복호화는 공용 함수에서 한다.
export async function GET() {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ jobs: await listOpeningMigrationJobs() }, { headers })
  } catch {
    return NextResponse.json(
      { message: '오프닝 이전 목록을 불러오지 못했습니다' },
      { status: 500, headers }
    )
  }
}
