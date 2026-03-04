import { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'

// GET /api/spaces — 현재 사용자의 Space + 활성 DeckInstance 목록 반환
export async function GET() {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  const membership = await prisma.spaceMember.findFirst({
    where: { userId: user.id },
    include: {
      space: {
        select: {
          id: true,
          name: true,
          currentPlan: true,
          deckInstances: {
            where: { isActive: true },
            include: {
              deckApp: {
                select: { id: true, name: true, description: true },
              },
            },
          },
        },
      },
    },
  })

  if (!membership) return errorResponse('공간이 없습니다', 404)

  return NextResponse.json({ space: membership.space, role: membership.role })
}
