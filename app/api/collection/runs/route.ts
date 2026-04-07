import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

// 10분 이상 RUNNING 상태면 타임아웃 처리
const STALE_THRESHOLD_MS = 10 * 60 * 1000

// GET /api/collection/runs — 수집 실행 이력 조회
export async function GET(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // 고착된 RUNNING 상태 자동 정리
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS)
  await prisma.collectionRun.updateMany({
    where: {
      workspaceId: workspace.id,
      status: { in: ['RUNNING', 'DOWNLOADING', 'PARSING'] },
      startedAt: { lt: staleThreshold },
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      error: '타임아웃: 10분 이상 응답 없음',
    },
  })

  // 페이지네이션 파라미터
  const url = new URL(request.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100)
  const cursor = url.searchParams.get('cursor')

  const runs = await prisma.collectionRun.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
  })

  // 다음 페이지 존재 여부 확인
  const hasMore = runs.length > limit
  if (hasMore) runs.pop()

  // uploadId가 있는 run에 대해 ReportUpload 정보 조회
  const uploadIds = runs.map((r) => r.uploadId).filter(Boolean) as string[]
  const uploads = uploadIds.length > 0
    ? await prisma.reportUpload.findMany({
        where: { id: { in: uploadIds } },
        select: { id: true, fileName: true, periodStart: true, periodEnd: true, totalRows: true, insertedRows: true, duplicateRows: true },
      })
    : []
  const uploadMap = new Map(uploads.map((u) => [u.id, u]))

  const runsWithUpload = runs.map((r) => ({
    ...r,
    upload: r.uploadId ? uploadMap.get(r.uploadId) ?? null : null,
  }))

  return NextResponse.json({
    runs: runsWithUpload,
    nextCursor: hasMore ? runs[runs.length - 1].id : null,
  })
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
      ...(isWorker && { startedAt: new Date() }),
    },
  })

  return NextResponse.json({ run }, { status: 201 })
}
