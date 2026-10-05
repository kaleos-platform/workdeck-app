import { withUnpublishedPosting } from '@/lib/hiring/unpublished-posting'
import {
  isPostingRecruitmentLocked,
  PUBLISHED_POSTING_LOCK_MESSAGE,
} from '@/lib/hiring/publication-policy'
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { updatePostingSchema } from '@/lib/validations/hiring-posts'
import { getPostingDetail } from '@/lib/hiring/postings'

type Params = { params: Promise<{ id: string }> }

// 공고 상세 (위저드용)
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const posting = await getPostingDetail(resolved.space.id, id)
  if (!posting) return errorResponse('공고를 찾을 수 없습니다', 404)
  return NextResponse.json({ posting })
}

// 기본 정보 수정
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, publishedAt: true },
  })
  if (!existing) return errorResponse('공고를 찾을 수 없습니다', 404)
  if (isPostingRecruitmentLocked(existing))
    return errorResponse(PUBLISHED_POSTING_LOCK_MESSAGE, 409)
  return withUnpublishedPosting(resolved.space.id, id, async (tx) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return errorResponse('잘못된 요청 형식입니다', 400)
    }

    const parsed = updatePostingSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
    }

    const { title, closingDate, notificationEnabled } = parsed.data
    const posting = await tx.hiringPosting.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(closingDate !== undefined && {
          closingDate: closingDate ? new Date(closingDate) : null,
        }),
        ...(notificationEnabled !== undefined && { notificationEnabled }),
      },
      select: { id: true, title: true, closingDate: true, notificationEnabled: true },
    })
    return NextResponse.json({ posting })
  })
}

// 공고 삭제
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const { id } = await params

  const existing = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('공고를 찾을 수 없습니다', 404)

  await prisma.hiringPosting.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
