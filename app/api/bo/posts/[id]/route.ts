import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { patchBoPostBodySchema } from '@/lib/bo/post-schemas'
import { assertBoPostTransition, BoPostTransitionError } from '@/lib/bo/post-state'
import { createBoPostVersion } from '@/lib/bo/post-versions'
import type { BoPostStatus, Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ id: string }> }

// GET /api/bo/posts/[id] — 포스트 상세 (버전 메타 목록 포함)
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const post = await prisma.boPost.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      versions: {
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          versionNumber: true,
          title: true,
          note: true,
          createdAt: true,
          createdByUserId: true,
        },
      },
      material: { select: { id: true, title: true } },
    },
  })
  if (!post) return errorResponse('포스트를 찾을 수 없습니다', 404)

  return NextResponse.json({ post })
}

// PATCH /api/bo/posts/[id] — 콘텐츠 편집 또는 상태 전환 (상호 배타적)
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // spaceId 범위 내 포스트 조회 (IDOR 방어)
  const existing = await prisma.boPost.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, title: true, doc: true, spaceId: true },
  })
  if (!existing) return errorResponse('포스트를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = patchBoPostBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const data = parsed.data
  const isContentEdit = data.title !== undefined || data.doc !== undefined
  const isStatusTransition = data.status !== undefined

  if (!isContentEdit && !isStatusTransition) {
    return errorResponse('변경할 필드가 없습니다', 400)
  }

  // ── 콘텐츠 편집 ──────────────────────────────────────────────────────────────
  if (isContentEdit) {
    // PUBLISH_APPROVED 상태에서 편집 시 자동으로 IN_REVIEW로 회귀
    const nextStatus: BoPostStatus =
      existing.status === 'PUBLISH_APPROVED' ? 'IN_REVIEW' : (existing.status as BoPostStatus)

    const updated = await prisma.$transaction(async (tx) => {
      // 편집 직전 버전 스냅샷
      await createBoPostVersion(tx, existing, '편집 직전 자동 저장', resolved.user.id)

      return tx.boPost.update({
        where: { id },
        data: {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.doc !== undefined ? { doc: data.doc as Prisma.InputJsonValue } : {}),
          status: nextStatus,
        },
        select: { id: true, title: true, status: true, doc: true, updatedAt: true },
      })
    })

    return NextResponse.json({ post: updated })
  }

  // ── 상태 전환 ────────────────────────────────────────────────────────────────
  const newStatus = data.status as BoPostStatus

  if (newStatus !== existing.status) {
    try {
      assertBoPostTransition(existing.status as BoPostStatus, newStatus)
    } catch (err) {
      if (err instanceof BoPostTransitionError) {
        return errorResponse(err.message, 422)
      }
      throw err
    }
  }

  // PUBLISH_APPROVED 전환 시 승인자·승인 시각 기록
  const approvalFields =
    newStatus === 'PUBLISH_APPROVED'
      ? { publishApprovedByUserId: resolved.user.id, publishApprovedAt: new Date() }
      : {}

  const updated = await prisma.boPost.update({
    where: { id },
    data: { status: newStatus, ...approvalFields },
    select: {
      id: true,
      status: true,
      publishApprovedByUserId: true,
      publishApprovedAt: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({ post: updated })
}

// DELETE /api/bo/posts/[id] — 소프트 삭제 (ARCHIVED 상태 전환)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const existing = await prisma.boPost.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!existing) return errorResponse('포스트를 찾을 수 없습니다', 404)

  // 이미 ARCHIVED면 멱등 응답
  if (existing.status === 'ARCHIVED') {
    return NextResponse.json({ post: { id, status: 'ARCHIVED' } })
  }

  const updated = await prisma.boPost.update({
    where: { id },
    data: { status: 'ARCHIVED' },
    select: { id: true, status: true, updatedAt: true },
  })

  return NextResponse.json({ post: updated })
}
