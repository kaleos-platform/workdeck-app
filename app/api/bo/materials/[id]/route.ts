import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { patchBoMaterialBodySchema } from '@/lib/bo/ideation-schemas'
import { assertBoMaterialTransition, BoMaterialTransitionError } from '@/lib/bo/material-state'
import type { BoMaterialStatus } from '@/generated/prisma/client'

// PATCH /api/bo/materials/[id] — 필드 편집 + 상태 전환
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // 공간 범위 내 소재 조회 — 현재 상태 확인 + IDOR 방어
  const existing = await prisma.boMaterial.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!existing) {
    return errorResponse('소재를 찾을 수 없습니다', 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = patchBoMaterialBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const { status: newStatus, ...fieldUpdates } = parsed.data

  // 상태 전환 유효성 검증
  if (newStatus && newStatus !== existing.status) {
    try {
      assertBoMaterialTransition(existing.status as BoMaterialStatus, newStatus as BoMaterialStatus)
    } catch (err) {
      if (err instanceof BoMaterialTransitionError) {
        return errorResponse(err.message, 422)
      }
      throw err
    }
  }

  // 승인 시 승인자·승인 시각 기록
  const approvalFields =
    newStatus === 'APPROVED' ? { approvedByUserId: resolved.user.id, approvedAt: new Date() } : {}

  // 기존 상태로 전환 요청이면 DB 쓰기 없이 현재 상태 반환
  const effectiveStatus = newStatus ?? existing.status

  const updated = await prisma.boMaterial.update({
    where: { id },
    data: {
      ...(fieldUpdates.title !== undefined ? { title: fieldUpdates.title } : {}),
      ...(fieldUpdates.appealPoint !== undefined ? { appealPoint: fieldUpdates.appealPoint } : {}),
      ...(fieldUpdates.angle !== undefined ? { angle: fieldUpdates.angle } : {}),
      ...(fieldUpdates.outline !== undefined ? { outline: fieldUpdates.outline as never } : {}),
      ...(fieldUpdates.targetKeyword !== undefined
        ? { targetKeyword: fieldUpdates.targetKeyword }
        : {}),
      status: effectiveStatus,
      ...approvalFields,
    },
    select: {
      id: true,
      title: true,
      appealPoint: true,
      angle: true,
      outline: true,
      targetKeyword: true,
      status: true,
      approvedByUserId: true,
      approvedAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ material: updated })
}
