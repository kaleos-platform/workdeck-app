// 자주 쓰는 메시지 목록/생성 — 목록은 읽기 권한, 생성은 쓰기 권한. spaceId 스코프.
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { messageTemplateSchema } from '@/lib/validations/hiring-applicants'
import { SAMPLE_MESSAGES } from '@/lib/hiring/message-template'

const SELECT = { id: true, title: true, content: true, updatedAt: true } as const

export async function GET() {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const items = await prisma.hiringMessageTemplate.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: SELECT,
  })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting', { write: true })
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const body = await req.json().catch(() => null)

  // 예시 3개 추가 — 동시 요청 중복 방지를 위해 advisory lock 후 개수 확인
  if (body && typeof body === 'object' && (body as { samples?: unknown }).samples === true) {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('hiring-msg-samples:' || ${spaceId}))`
      if ((await tx.hiringMessageTemplate.count({ where: { spaceId } })) > 0) return null
      await tx.hiringMessageTemplate.createMany({
        data: SAMPLE_MESSAGES.map((m) => ({ spaceId, ...m })),
      })
      return tx.hiringMessageTemplate.findMany({
        where: { spaceId },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: SELECT,
      })
    })
    if (!created) return errorResponse('이미 등록된 메시지가 있습니다', 409)
    return NextResponse.json({ items: created }, { status: 201 })
  }

  const parsed = messageTemplateSchema.safeParse(body)
  if (!parsed.success) return errorResponse('제목과 내용을 입력하세요', 400)

  const item = await prisma.hiringMessageTemplate.create({
    data: { spaceId, title: parsed.data.title, content: parsed.data.content },
    select: SELECT,
  })
  return NextResponse.json({ item }, { status: 201 })
}
