import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { contentUpdateSchema } from '@/lib/sc/schemas'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const content = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      assets: true,
      channel: { select: { id: true, name: true, platform: true } },
    },
  })
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  return NextResponse.json({ content })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true, status: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  // PUBLISHED/ANALYZED 상태의 doc 직접 수정 금지 (draft 로 되돌린 후 수정).
  if (existing.status === 'PUBLISHED' || existing.status === 'ANALYZED') {
    return errorResponse('배포 이후에는 직접 수정할 수 없습니다', 409)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = contentUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const updated = await prisma.content.update({
    where: { id },
    data: {
      title: parsed.data.title ?? undefined,
      doc: (parsed.data.doc ?? undefined) as never,
      channelId: parsed.data.channelId ?? undefined,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
    },
  })
  return NextResponse.json({ content: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.content.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)

  await prisma.content.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
