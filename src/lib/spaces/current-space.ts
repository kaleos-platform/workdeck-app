import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { CURRENT_SPACE_COOKIE, CURRENT_SPACE_COOKIE_OPTIONS } from './current-space-cookie'

export { CURRENT_SPACE_COOKIE, CURRENT_SPACE_COOKIE_OPTIONS }

type Role = 'OWNER' | 'ADMIN' | 'MEMBER'
export type CurrentMembership = { role: Role; space: { id: string; name: string } }

// 요청 안에서 한 번만 조회한다(cache) — 해석기와 /api/spaces/current 목록이 함께 쓴다.
export const listMemberships = cache(function listMemberships(userId: string) {
  return prisma.spaceMember.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, createdAt: true, space: { select: { id: true, name: true } } },
  }) as Promise<Array<CurrentMembership & { createdAt: Date }>>
})

/**
 * 현재 Space 멤버십: requested(?spaceId) → 쿠키 wd_space → OWNER 최고참 → 최고참.
 * 쿠키는 신뢰하지 않는다(비구성원 값은 무시). 명시 requested 가 비구성원이면 forbidden —
 * 링크·승인 URL 이 가리킨 Space 대신 다른 Space 에 쓰지 않게.
 */
export const resolveCurrentMembership = cache(async function resolveCurrentMembership(
  userId: string,
  requested?: string | null
): Promise<CurrentMembership | { forbidden: true } | null> {
  const all = await listMemberships(userId)
  if (all.length === 0) return null
  const pick = (id?: string | null) => (id ? all.find((x) => x.space.id === id) : undefined)
  const strip = (x: CurrentMembership & { createdAt: Date }): CurrentMembership => ({
    role: x.role,
    space: x.space,
  })

  if (requested) {
    const hit = pick(requested)
    return hit ? strip(hit) : { forbidden: true }
  }
  const fromCookie = pick((await cookies()).get(CURRENT_SPACE_COOKIE)?.value)
  if (fromCookie) return strip(fromCookie)
  return strip(all.find((x) => x.role === 'OWNER') ?? all[0])
})
