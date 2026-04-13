import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { runAndSaveInventoryAnalysis } from '@/lib/inventory-analyzer'

// POST /api/inventory/analysis/worker — 워커 전용 재분석 엔드포인트
export async function POST(request: NextRequest) {
  const workerAuth = resolveWorkerAuth(request)
  if ('error' in workerAuth) {
    return workerAuth.error
  }

  const body = await request.json().catch(() => ({}))
  if (!body.workspaceId) {
    return errorResponse('workspaceId가 필요합니다', 400)
  }

  const result = await runAndSaveInventoryAnalysis({
    workspaceId: body.workspaceId,
    triggeredBy: 'worker',
    sendSlack: true,
  })

  if (!result) {
    return errorResponse('분석할 재고 데이터가 없습니다', 404)
  }

  return NextResponse.json(result)
}
