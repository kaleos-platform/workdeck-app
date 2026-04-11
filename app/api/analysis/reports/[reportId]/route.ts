// GET /api/analysis/reports/[reportId] — 개별 분석 리포트 상세 조회
// PATCH /api/analysis/reports/[reportId] — 분석 취소
// DELETE /api/analysis/reports/[reportId] — 분석 리포트 삭제

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const { reportId } = await params

  // Worker 인증 시도
  const workerAuth = resolveWorkerAuth(request)
  if (!('error' in workerAuth)) {
    // Worker: workspaceId 필터 없이 조회
    const report = await prisma.analysisReport.findUnique({
      where: { id: reportId },
    })
    if (!report) return errorResponse('리포트를 찾을 수 없습니다', 404)
    return NextResponse.json({ report })
  }

  // 사용자 세션 인증
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const report = await prisma.analysisReport.findFirst({
    where: { id: reportId, workspaceId: resolved.workspace.id },
  })
  if (!report) return errorResponse('리포트를 찾을 수 없습니다', 404)

  return NextResponse.json({ report })
}

// PATCH — 분석 취소 (PENDING/PROCESSING → FAILED)
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { reportId } = await params

  const report = await prisma.analysisReport.findFirst({
    where: { id: reportId, workspaceId: workspace.id },
    select: { id: true, status: true },
  })

  if (!report) {
    return errorResponse('리포트를 찾을 수 없습니다', 404)
  }

  if (report.status !== 'PENDING' && report.status !== 'PROCESSING') {
    return errorResponse('진행 중인 분석만 종료할 수 있습니다', 400)
  }

  await prisma.analysisReport.update({
    where: { id: reportId },
    data: {
      status: 'FAILED',
      summary: '사용자에 의해 취소됨',
    },
  })

  return NextResponse.json({ cancelled: true })
}

// DELETE — 분석 리포트 삭제
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { reportId } = await params

  const report = await prisma.analysisReport.findFirst({
    where: { id: reportId, workspaceId: workspace.id },
    select: { id: true },
  })

  if (!report) {
    return errorResponse('리포트를 찾을 수 없습니다', 404)
  }

  await prisma.analysisReport.delete({ where: { id: reportId } })

  return NextResponse.json({ deleted: true })
}
