import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'

// POST /api/workspace — 워크스페이스 생성 (1인 1워크스페이스)
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return errorResponse('워크스페이스 이름을 입력해주세요', 400)

  // Supabase Auth UUID ↔ Prisma User 동기화
  await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email ?? '',
      name: user.user_metadata?.name ?? null,
    },
    update: {
      email: user.email ?? '',
    },
  })

  const result = await prisma.$transaction(async (tx) => {
    const existingWorkspace = await tx.workspace.findUnique({
      where: { ownerId: user.id },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
    })

    const workspace =
      existingWorkspace ??
      (await tx.workspace.create({
        data: {
          name,
          ownerId: user.id,
        },
        select: {
          id: true,
          name: true,
          createdAt: true,
        },
      }))

    const existingMembership = await tx.spaceMember.findFirst({
      where: { userId: user.id },
      select: { id: true },
    })

    // 기존 계정 호환: Workspace만 존재하는 계정은 Space 구조를 자동 복구한다.
    if (!existingMembership) {
      await tx.deckApp.upsert({
        where: { id: 'coupang-ads' },
        create: {
          id: 'coupang-ads',
          name: '쿠팡 광고 자동화',
          isActive: true,
        },
        update: {},
      })

      await tx.space.create({
        data: {
          name: workspace.name,
          type: 'PERSONAL',
          members: {
            create: {
              userId: user.id,
              role: 'OWNER',
            },
          },
          deckInstances: {
            create: {
              deckAppId: 'coupang-ads',
              isActive: true,
            },
          },
        },
      })
    }

    return {
      workspace,
      createdWorkspace: !existingWorkspace,
    }
  })

  return NextResponse.json(result.workspace, { status: result.createdWorkspace ? 201 : 200 })
}
