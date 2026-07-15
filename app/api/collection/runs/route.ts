import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { queryCollectionRuns } from '@/lib/coupang-ads/queries'

// GET /api/collection/runs — 수집 실행 이력 조회
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // 페이지네이션 파라미터
  const url = new URL(request.url)
  const limit = Number(url.searchParams.get('limit')) || 20
  const cursor = url.searchParams.get('cursor')

  return NextResponse.json(await queryCollectionRuns(workspace.id, { limit, cursor }))
}

// POST /api/collection/runs — 수집 트리거 (사용자 세션 OR Worker 인증)
export async function POST(request: NextRequest) {
  // Worker 인증 시 body에서 workspaceId + triggeredBy 읽기
  const workerKey = request.headers.get('x-worker-api-key')
  const expectedKey = process.env.WORKER_API_KEY
  const isWorker = Boolean(workerKey && expectedKey && workerKey === expectedKey)

  let workspaceId: string
  let triggeredBy = 'manual'

  if (isWorker) {
    const body = await request.json().catch(() => ({}))
    if (!body.workspaceId) {
      // Worker가 workspaceId 없이 호출 시 첫 번째 활성 자격증명의 workspace 사용
      const cred = await prisma.coupangCredential.findFirst({
        where: { isActive: true },
        select: { workspaceId: true },
      })
      if (!cred) return errorResponse('활성 워크스페이스가 없습니다', 404)
      workspaceId = cred.workspaceId
    } else {
      workspaceId = body.workspaceId
    }
    triggeredBy = body.triggeredBy ?? 'scheduled'
  } else {
    const resolved = await resolveWorkspace()
    if ('error' in resolved) return resolved.error
    workspaceId = resolved.workspace.id
  }

  const workspace = { id: workspaceId }

  // 수동 수집 작업 스코프 — 사용자(비-worker) 요청에서만 받는다. 미지정/worker(자동)는
  // 둘 다 true(전체 수집, 현행 유지). 판매(VENDOR)는 수동에서 항상 제외(워커가 보장).
  let collectAds = true
  let collectInventory = true
  if (!isWorker) {
    const scopeBody = await request.json().catch(() => ({}) as Record<string, unknown>)
    if (typeof scopeBody.collectAds === 'boolean') collectAds = scopeBody.collectAds
    if (typeof scopeBody.collectInventory === 'boolean')
      collectInventory = scopeBody.collectInventory
    if (!collectAds && !collectInventory) {
      return errorResponse('최소 한 가지 작업을 선택해야 합니다', 422)
    }
  }

  // 자격증명 존재 확인
  const credential = await prisma.coupangCredential.findUnique({
    where: { workspaceId: workspace.id },
    select: { id: true, isActive: true },
  })
  if (!credential || !credential.isActive) {
    return errorResponse('쿠팡 자격증명이 설정되지 않았거나 비활성 상태입니다', 400)
  }

  // 이미 진행 중인 실행이 있는지 확인
  const activeRun = await prisma.collectionRun.findFirst({
    where: {
      workspaceId: workspace.id,
      status: { in: ['PENDING', 'RUNNING', 'DOWNLOADING', 'PARSING'] },
    },
  })
  if (activeRun) {
    return errorResponse('이미 진행 중인 수집 작업이 있습니다', 409)
  }

  // 새 수집 실행 생성
  const status = isWorker ? 'RUNNING' : 'PENDING' // Worker는 직접 실행, UI는 Worker 폴링 대기
  const run = await prisma.collectionRun.create({
    data: {
      workspaceId: workspace.id,
      triggeredBy,
      status,
      collectAds,
      collectInventory,
      ...(isWorker && { startedAt: new Date() }),
    },
  })

  return NextResponse.json({ run }, { status: 201 })
}
