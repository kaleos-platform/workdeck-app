import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

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

// POST /api/collection/runs — 수동 수집 트리거
export async function POST() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

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

  // 새 수집 실행 생성 (PENDING 상태 — Worker가 폴링하여 실행)
  const run = await prisma.collectionRun.create({
    data: {
      workspaceId: workspace.id,
      triggeredBy: 'manual',
      status: 'PENDING',
    },
  })

  return NextResponse.json({ run }, { status: 201 })
}
