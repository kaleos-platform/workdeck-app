import type { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'

/**
 * 경로의 spaceId 기준으로 ADMIN 이상인지 확인한다.
 * resolveSpaceContext(최고참 멤버십)를 쓰지 않는다 — 두 Space에 속한 구성원(상원)이
 * 다른 Space의 에이전트를 관리할 수 있어야 하기 때문이다.
 */
export async function requireSpaceAdmin(
  spaceId: string
): Promise<{ userId: string } | { error: NextResponse }> {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId: user.id } },
    select: { role: true },
  })
  if (!member || (member.role !== 'OWNER' && member.role !== 'ADMIN')) {
    return { error: errorResponse('권한이 없습니다', 403) }
  }
  return { userId: user.id }
}
