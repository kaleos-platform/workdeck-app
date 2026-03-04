import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type CreateDeckRequest = {
  deckAppId?: string
}

// POST /api/spaces/decks — 현재 Space에 Deck 활성화
export async function POST(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error

  const body = (await request.json().catch(() => null)) as CreateDeckRequest | null
  const deckAppId = typeof body?.deckAppId === 'string' ? body.deckAppId.trim() : ''
  if (!deckAppId) return errorResponse('deckAppId가 필요합니다', 400)

  const deckApp = await prisma.deckApp.findUnique({
    where: { id: deckAppId },
    select: { id: true, name: true, description: true, isActive: true },
  })
  if (!deckApp || !deckApp.isActive) {
    return errorResponse('사용 가능한 Deck이 아닙니다', 404)
  }

  const existing = await prisma.deckInstance.findUnique({
    where: {
      spaceId_deckAppId: {
        spaceId: resolved.space.id,
        deckAppId,
      },
    },
    select: { id: true, isActive: true },
  })

  if (existing?.isActive) {
    return errorResponse('이미 사용 중인 Deck입니다', 409)
  }

  if (existing) {
    const updated = await prisma.deckInstance.update({
      where: { id: existing.id },
      data: { isActive: true },
      select: { id: true, deckAppId: true, isActive: true },
    })
    return NextResponse.json({ deck: deckApp, instance: updated })
  }

  const created = await prisma.deckInstance.create({
    data: {
      spaceId: resolved.space.id,
      deckAppId,
      isActive: true,
    },
    select: { id: true, deckAppId: true, isActive: true },
  })

  return NextResponse.json({ deck: deckApp, instance: created }, { status: 201 })
}
