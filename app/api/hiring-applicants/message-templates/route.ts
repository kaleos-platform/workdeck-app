// 알림 메시지 템플릿 목록/생성 — 목록은 읽기 권한, 생성은 쓰기 권한. spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveAnyDeckContext, resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { messageTemplateSchema } from '@/lib/validations/hiring-applicants'

export async function GET() {
  const resolved = await resolveAnyDeckContext(['hiring-applicants', 'hiring-posts'])
  if ('error' in resolved) return resolved.error

  const items = await prisma.hiringMessageTemplate.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, content: true, updatedAt: true },
  })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('hiring-applicants')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => null)
  const parsed = messageTemplateSchema.safeParse(body)
  if (!parsed.success) return errorResponse('제목과 내용을 입력하세요', 400)

  const created = await prisma.hiringMessageTemplate.create({
    data: {
      spaceId: resolved.space.id,
      title: parsed.data.title,
      content: parsed.data.content,
    },
    select: { id: true, title: true, content: true, updatedAt: true },
  })
  return NextResponse.json({ item: created }, { status: 201 })
}
