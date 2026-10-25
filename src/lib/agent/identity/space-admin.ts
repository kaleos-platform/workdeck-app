import type { NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { hasRole, type Role } from '@/lib/auth/roles'

/**
 * 경로의 spaceId 기준으로 required 역할 이상인지 확인한다.
 * resolveSpaceContext(현재 Space 멤버십)를 쓰지 않는다 — 두 Space에 속한 구성원이
 * 현재 Space가 아닌 경로의 Space도 관리할 수 있어야 하기 때문이다.
 */
async function requireSpaceRole(
  spaceId: string,
  required: Role
): Promise<{ userId: string; role: Role } | { error: NextResponse }> {
  const user = await getUser()
  if (!user) return { error: errorResponse('인증이 필요합니다', 401) }
  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId: user.id } },
    select: { role: true },
  })
  if (!member || !hasRole(member.role as Role, required)) {
    return { error: errorResponse('권한이 없습니다', 403) }
  }
  return { userId: user.id, role: member.role as Role }
}

/** ADMIN 이상(OWNER·ADMIN). */
export function requireSpaceAdmin(spaceId: string) {
  return requireSpaceRole(spaceId, 'ADMIN')
}

/** OWNER만 — 승인 한도처럼 승인 정책 자체를 바꾸는 작업. */
export function requireSpaceOwner(spaceId: string) {
  return requireSpaceRole(spaceId, 'OWNER')
}
