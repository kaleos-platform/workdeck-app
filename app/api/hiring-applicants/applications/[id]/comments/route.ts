// 지원서 내부 코멘트 생성 — 쓰기 권한 + spaceId 스코프. author = 세션 user id.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { commentSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = commentSchema.safeParse(body)
  if (!parsed.success) return errorResponse('내용을 입력하세요', 400)

  const app = await prisma.hiringApplication.findFirst({
    where: { id, spaceId: resolved.space.id, deletedAt: null },
    select: { id: true },
  })
  if (!app) return errorResponse('지원서를 찾을 수 없습니다', 404)

  const comment = await prisma.hiringComment.create({
    data: {
      spaceId: resolved.space.id,
      applicationId: id,
      userId: resolved.user.id,
      content: parsed.data.content,
    },
    select: { id: true, userId: true, content: true, createdAt: true, editedAt: true },
  })

  return NextResponse.json({ comment }, { status: 201 })
}
