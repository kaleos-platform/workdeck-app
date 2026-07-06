// 코멘트 수정/삭제 — 쓰기 권한 + spaceId 스코프 + 작성자 본인만.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { commentSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string; commentId: string }> }

async function loadOwnComment(spaceId: string, userId: string, commentId: string) {
  const comment = await prisma.hiringComment.findFirst({
    where: { id: commentId, spaceId, deletedAt: null },
    select: { id: true, userId: true },
  })
  if (!comment) return { error: errorResponse('코멘트를 찾을 수 없습니다', 404) }
  if (comment.userId !== userId) return { error: errorResponse('작성자만 수정할 수 있습니다', 403) }
  return { comment }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { commentId } = await params

  const body = await req.json().catch(() => null)
  const parsed = commentSchema.safeParse(body)
  if (!parsed.success) return errorResponse('내용을 입력하세요', 400)

  const own = await loadOwnComment(resolved.space.id, resolved.user.id, commentId)
  if ('error' in own) return own.error

  const comment = await prisma.hiringComment.update({
    where: { id: commentId },
    data: { content: parsed.data.content, editedAt: new Date() },
    select: { id: true, userId: true, content: true, createdAt: true, editedAt: true },
  })
  return NextResponse.json({ comment })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { commentId } = await params

  const own = await loadOwnComment(resolved.space.id, resolved.user.id, commentId)
  if ('error' in own) return own.error

  await prisma.hiringComment.update({
    where: { id: commentId },
    data: { deletedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
