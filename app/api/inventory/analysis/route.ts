import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { runAndSaveInventoryAnalysis } from '@/lib/inventory-analyzer'

// GET /api/inventory/analysis — 최신 분석 결과 조회 (stale-skip marker 제외)
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const analysis = await prisma.inventoryAnalysis.findFirst({
    where: {
      workspaceId: resolved.workspace.id,
      triggeredBy: { not: 'stale-skip' },
    },
    orderBy: { analysedAt: 'desc' },
  })

  if (!analysis) {
    return NextResponse.json(null)
  }

  return NextResponse.json(analysis)
}

// POST /api/inventory/analysis — 분석 실행
export async function POST(request: NextRequest) {
  // 워커 인증 또는 사용자 세션 인증
  const workerAuth = resolveWorkerAuth(request)
  let workspaceId: string

  if ('error' in workerAuth) {
    // 워커 키가 제공되었으나 인증 실패 시 경고 로그
    if (request.headers.get('x-worker-api-key')) {
      console.warn(
        '[inventory/analysis] x-worker-api-key 제공되었으나 인증 실패 — 세션 인증으로 폴백'
      )
    }
    // 워커 인증 실패 → 사용자 세션 인증 시도
    const resolved = await resolveWorkspace()
    if ('error' in resolved) return resolved.error
    workspaceId = resolved.workspace.id
  } else {
    // 워커 인증 성공 → body에서 workspaceId 읽기
    const body = await request.json().catch(() => ({}))
    if (!body.workspaceId) {
      return errorResponse('workspaceId가 필요합니다', 400)
    }
    workspaceId = body.workspaceId
  }

  const isManual = 'error' in workerAuth
  const triggeredBy = isManual ? 'manual' : 'worker'

  const result = await runAndSaveInventoryAnalysis({
    workspaceId,
    triggeredBy,
    sendSlack: true,
    // 사용자 수동 재분석은 stale 데이터여도 그대로 실행 (워커 무음실패 와중에도
    // 사용자가 마지막 결과를 다시 보고 싶어할 수 있음).
    allowStale: isManual,
  })

  if (!result) {
    return errorResponse('분석할 재고 데이터가 없습니다', 404)
  }

  return NextResponse.json(result)
}
