import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const ideation = await prisma.contentIdea.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      product: { select: { id: true, name: true, slug: true } },
      persona: { select: { id: true, name: true, slug: true } },
    },
  })
  if (!ideation) return errorResponse('아이데이션을 찾을 수 없습니다', 404)

  return NextResponse.json({ ideation })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.contentIdea.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('아이데이션을 찾을 수 없습니다', 404)

  await prisma.contentIdea.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
