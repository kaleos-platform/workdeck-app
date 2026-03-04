import { NextRequest, NextResponse } from 'next/server'
import { assertSameSpace, resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/spaces — 현재 사용자의 Space + 활성 DeckInstance 목록 반환
export async function GET(request: NextRequest) {
  const resolved = await resolveDeckContext('coupang-ads')
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
      deckInstances: {
        where: { isActive: true },
        include: {
          deckApp: {
            select: { id: true, name: true, description: true },
          },
        },
      },
    },
  })

  return NextResponse.json({ space: space ?? resolved.space, role: resolved.role })
}
