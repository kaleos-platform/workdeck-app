import { withUnpublishedPosting } from '@/lib/hiring/unpublished-posting'
import {
  isPostingRecruitmentLocked,
  PUBLISHED_POSTING_LOCK_MESSAGE,
} from '@/lib/hiring/publication-policy'
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse, assertRole } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { updatePostingSchema } from '@/lib/validations/hiring-posts'
import { isHiringDeadlinePassed } from '@/lib/hiring/closing-date'
import { getPostingDetail } from '@/lib/hiring/postings'
import { deletePosting } from '@/lib/hiring/delete'

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
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringPosting.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true, publishedAt: true, closingDate: true },
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
    // 기존 값을 그대로 두는 저장은 허용하고, 바뀐 날짜가 KST 오늘 이전이면 거부한다.
    if (
      closingDate &&
      closingDate !== existing.closingDate?.toISOString().slice(0, 10) &&
      isHiringDeadlinePassed(new Date(closingDate))
    )
      return errorResponse('오늘 이전 날짜는 마감일로 선택할 수 없습니다', 400)
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
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error

  const roleError = assertRole(resolved.role, 'ADMIN')
  if (roleError) return roleError
  const { id } = await params

  const result = await deletePosting(resolved.space.id, id)
  if (result.status === 'not_found') return errorResponse('공고를 찾을 수 없습니다', 404)
  if (result.status === 'open')
    return errorResponse(
      '모집중인 공고는 삭제할 수 없어요. 먼저 마감 처리한 뒤 삭제해 주세요.',
      409
    )
  return NextResponse.json({ ok: true, deletedApplications: result.deletedApplications })
}
