import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { assertSameSpace, errorResponse, resolveSpaceContext } from '@/lib/api-helpers'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { createOwnedSpaceInTx, MAX_OWNED_SPACES } from '@/lib/spaces/create-owned-space'
import { spaceNameSchema } from '@/lib/validations/admin-users'

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

// POST /api/spaces — 로그인 사용자가 자신이 OWNER 인 새 Space 를 만든다(업무는 켜지 않는다).
// 같은 이름 소유 Space 가 있으면 409 + spaceId, 소유 5개면 409 SPACE_LIMIT.
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('로그인이 필요합니다', 401)

  const parsed = z
    .object({ name: spaceNameSchema })
    .safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 422, { issues: parsed.error.issues })
  }

  try {
    const result = await prisma.$transaction((tx) =>
      createOwnedSpaceInTx(tx, {
        userId: user.id,
        name: parsed.data.name,
        maxOwned: MAX_OWNED_SPACES,
      })
    )
    if ('duplicateSpaceId' in result) {
      return errorResponse('같은 이름의 작업 공간이 이미 있습니다', 409, {
        spaceId: result.duplicateSpaceId,
      })
    }
    if ('limitReached' in result) {
      return errorResponse('소유한 작업 공간은 5개까지입니다', 409, { code: 'SPACE_LIMIT' })
    }
    // 이름·이메일은 남기지 않는다. blockedJobs>0 이면 운영자가 오프닝 큐 「차단」 탭에서 식별한다.
    console.info('space.create.user', {
      userId: user.id,
      spaceId: result.space.id,
      blockedJobs: result.blockedJobs,
    })
    return NextResponse.json({ space: result.space }, { status: 201 })
  } catch {
    return errorResponse('작업 공간을 만들지 못했습니다', 500)
  }
}
