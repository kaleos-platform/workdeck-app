// 알림 메시지 템플릿 수정/삭제 — 쓰기 권한 + spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { messageTemplateSchema } from '@/lib/validations/hiring-applicants'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const body = await req.json().catch(() => null)
  const parsed = messageTemplateSchema.safeParse(body)
  if (!parsed.success) return errorResponse('제목과 내용을 입력하세요', 400)

  const result = await prisma.hiringMessageTemplate.updateMany({
    where: { id, spaceId: resolved.space.id },
    data: { title: parsed.data.title, content: parsed.data.content },
  })
  if (result.count === 0) return errorResponse('템플릿을 찾을 수 없습니다', 404)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const result = await prisma.hiringMessageTemplate.deleteMany({
    where: { id, spaceId: resolved.space.id },
  })
  if (result.count === 0) return errorResponse('템플릿을 찾을 수 없습니다', 404)
  return NextResponse.json({ ok: true })
}
