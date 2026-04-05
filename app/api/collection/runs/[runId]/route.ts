import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { CollectionStatus } from '@/generated/prisma/client'

// GET /api/collection/runs/[runId] — 수집 실행 상세 조회
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { runId } = await params

  const run = await prisma.collectionRun.findUnique({
    where: { id: runId },
  })

  if (!run || run.workspaceId !== workspace.id) {
    return errorResponse('수집 실행을 찾을 수 없습니다', 404)
  }

  return NextResponse.json({ run })
}

// 유효한 상태 값 목록
const VALID_STATUSES: CollectionStatus[] = [
  'PENDING',
  'RUNNING',
  'DOWNLOADING',
  'PARSING',
  'COMPLETED',
  'FAILED',
]

// PATCH /api/collection/runs/[runId] — 워커의 상태 업데이트
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  // 워커 인증
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const { runId } = await params

  let body: {
    status?: string
    error?: string | null
    uploadId?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문이 올바르지 않습니다', 400)
  }

  // 상태 값 검증
  if (body.status && !VALID_STATUSES.includes(body.status as CollectionStatus)) {
    return errorResponse(`유효하지 않은 상태입니다: ${body.status}`, 400)
  }

  const run = await prisma.collectionRun.findUnique({
    where: { id: runId },
  })
  if (!run) {
    return errorResponse('수집 실행을 찾을 수 없습니다', 404)
  }

  // 상태 전이에 따른 타임스탬프 자동 설정
  const now = new Date()
  const isStarting = body.status === 'RUNNING' && run.status === 'PENDING'
  const isCompleting = body.status === 'COMPLETED' || body.status === 'FAILED'

  const updated = await prisma.collectionRun.update({
    where: { id: runId },
    data: {
      ...(body.status && { status: body.status as CollectionStatus }),
      ...(body.error !== undefined && { error: body.error }),
      ...(body.uploadId !== undefined && { uploadId: body.uploadId }),
      ...(isStarting && { startedAt: now }),
      ...(isCompleting && { completedAt: now }),
    },
  })

  return NextResponse.json({ run: updated })
}

// DELETE /api/collection/runs/[runId] — 진행 중인 수집 강제 종료
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { runId } = await params

  const run = await prisma.collectionRun.findUnique({
    where: { id: runId },
  })

  if (!run || run.workspaceId !== workspace.id) {
    return errorResponse('수집 실행을 찾을 수 없습니다', 404)
  }

  // 이미 완료/실패한 작업은 강제 종료 불가
  if (run.status === 'COMPLETED' || run.status === 'FAILED') {
    return errorResponse('이미 종료된 작업입니다', 400)
  }

  const updated = await prisma.collectionRun.update({
    where: { id: runId },
    data: {
      status: 'FAILED',
      error: '사용자에 의해 강제 종료됨',
      completedAt: new Date(),
    },
  })

  return NextResponse.json({ run: updated })
}
