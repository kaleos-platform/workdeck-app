import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createBoPostVersion } from '@/lib/bo/post-versions'
import { restoreBoPostVersionBodySchema } from '@/lib/bo/post-schemas'
import type { BoPostStatus, Prisma } from '@/generated/prisma/client'

type Params = { params: Promise<{ id: string }> }

// GET /api/bo/posts/[id]/versions — 버전 목록
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // spaceId 범위 내 포스트 검증 (IDOR 방어)
  const post = await prisma.boPost.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!post) return errorResponse('포스트를 찾을 수 없습니다', 404)

  const versions = await prisma.boPostVersion.findMany({
    where: { postId: id },
    orderBy: { versionNumber: 'desc' },
    select: {
      id: true,
      versionNumber: true,
      title: true,
      note: true,
      createdAt: true,
      createdByUserId: true,
    },
  })

  return NextResponse.json({ versions })
}

// POST /api/bo/posts/[id]/versions — 특정 버전으로 복원
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = restoreBoPostVersionBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const txResult = await prisma.$transaction(async (tx) => {
    // 현재 포스트 조회 (spaceId IDOR 방어)
    const currentPost = await tx.boPost.findFirst({
      where: { id, spaceId: resolved.space.id },
      select: { id: true, spaceId: true, title: true, doc: true, status: true },
    })
    if (!currentPost) return { notFound: 'post' as const }

    // 복원 대상 버전 조회
    const targetVersion = await tx.boPostVersion.findFirst({
      where: { postId: id, versionNumber: parsed.data.versionNumber },
      select: { id: true, versionNumber: true, title: true, doc: true },
    })
    if (!targetVersion) return { notFound: 'version' as const }

    // PUBLISHED/ARCHIVED 상태에서는 복원 불가
    if (currentPost.status === 'PUBLISHED' || currentPost.status === 'ARCHIVED') {
      return { terminalState: true as const }
    }

    // 복원 직전 현재 상태를 스냅샷으로 보존
    await createBoPostVersion(tx, currentPost, '복원 직전 자동 저장', resolved.user.id)

    // 복원 시도 = 콘텐츠 변경 → PUBLISH_APPROVED 이면 IN_REVIEW 회귀
    const nextStatus: BoPostStatus =
      currentPost.status === 'PUBLISH_APPROVED' ? 'IN_REVIEW' : (currentPost.status as BoPostStatus)

    const updated = await tx.boPost.update({
      where: { id },
      data: {
        title: targetVersion.title,
        doc: targetVersion.doc as Prisma.InputJsonValue,
        status: nextStatus,
      },
      select: { id: true, title: true, status: true, updatedAt: true },
    })

    return { post: updated, restoredVersionNumber: targetVersion.versionNumber }
  })

  if ('notFound' in txResult) {
    return txResult.notFound === 'post'
      ? errorResponse('포스트를 찾을 수 없습니다', 404)
      : errorResponse('버전을 찾을 수 없습니다', 404)
  }

  if ('terminalState' in txResult) {
    return errorResponse('게시됨 또는 보관된 포스트는 버전을 복원할 수 없습니다', 400)
  }

  return NextResponse.json(txResult)
}
