// PATCH/DELETE /api/analysis/rules/[ruleId] — 분석 규칙 토글 및 삭제

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// PATCH — 규칙 활성/비활성 토글
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { ruleId } = await params

  // 소유권 확인
  const existing = await prisma.analysisRule.findUnique({ where: { id: ruleId } })
  if (!existing || existing.workspaceId !== workspace.id) {
    return errorResponse('규칙을 찾을 수 없습니다', 404)
  }

  let body: { isActive?: boolean }
  try {
    body = await request.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const updated = await prisma.analysisRule.update({
    where: { id: ruleId },
    data: {
      isActive: body.isActive ?? !existing.isActive,
    },
    select: {
      id: true,
      rule: true,
      source: true,
      isActive: true,
      appliedCount: true,
      createdAt: true,
    },
  })

  return NextResponse.json(updated)
}

// DELETE — 규칙 삭제
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { ruleId } = await params

  // 소유권 확인
  const existing = await prisma.analysisRule.findUnique({ where: { id: ruleId } })
  if (!existing || existing.workspaceId !== workspace.id) {
    return errorResponse('규칙을 찾을 수 없습니다', 404)
  }

  await prisma.analysisRule.delete({ where: { id: ruleId } })

  return NextResponse.json({ ok: true })
}
