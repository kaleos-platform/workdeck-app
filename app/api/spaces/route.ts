import { NextRequest, NextResponse } from 'next/server'
import { assertSameSpace, resolveSpaceContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/spaces — 현재 사용자의 Space + 활성 DeckInstance 목록 반환
export async function GET(request: NextRequest) {
  const resolved = await resolveSpaceContext()
  if ('error' in resolved) return resolved.error

  const requestedSpaceId = request.nextUrl.searchParams.get('spaceId')
  if (requestedSpaceId) {
    const forbidden = assertSameSpace(resolved.space.id, requestedSpaceId)
    if (forbidden) return forbidden
  }

  const space = await prisma.space.findUnique({
    where: { id: resolved.space.id },
    select: {
      id: true,
      name: true,
    },
  })

  if (!space) return NextResponse.json({ space: resolved.space, role: resolved.role })

  const [activeDecks, availableDecks] = await Promise.all([
    prisma.deckInstance.findMany({
      where: { spaceId: space.id, isActive: true },
      include: {
        deckApp: {
          select: { id: true, name: true, description: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.deckApp.findMany({
      where: {
        isActive: true,
        instances: {
          none: {
            spaceId: space.id,
            isActive: true,
          },
        },
      },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    }),
  ])

  return NextResponse.json({
    space: {
      id: space.id,
      name: space.name,
      activeDecks: activeDecks.map(({ deckApp }) => deckApp),
      availableDecks,
    },
    role: resolved.role,
  })
}
