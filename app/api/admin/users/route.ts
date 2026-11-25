import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { getVerifiedTotpUserIds } from '@/lib/admin/mfa-status'

const PAGE_SIZE = 50

// 정렬 키 → orderBy. id 를 마지막에 붙여 페이지 사이 순서를 고정한다.
// 이름 NULL 정렬은 Prisma 커서와 맞지 않아(경계 행 누락) offset 페이지네이션을 쓴다.
const SORTS = {
  createdAt: (dir: 'asc' | 'desc') => ({ createdAt: dir }),
  email: (dir: 'asc' | 'desc') => ({ email: dir }),
  name: (dir: 'asc' | 'desc') => ({ name: { sort: dir, nulls: 'last' as const } }),
  spaces: (dir: 'asc' | 'desc') => ({ spaceMemberships: { _count: dir } }),
}

// GET /api/admin/users — 검색(email·name 부분일치) + 가입 경로(source)·운영자(role)·Space 소속(spaces) 필터
// + 정렬(sort=createdAt|email|name|spaces, dir=asc|desc) + offset 페이지네이션
export async function GET(request: NextRequest) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0))
  const source = url.searchParams.get('source')?.trim()
  const role = url.searchParams.get('role') // operator | user
  const spaces = url.searchParams.get('spaces') // some | none
  const mfa = url.searchParams.get('mfa') // required | off
  const sortParam = url.searchParams.get('sort') ?? 'createdAt'
  const sortKey = (sortParam in SORTS ? sortParam : 'createdAt') as keyof typeof SORTS
  const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc'

  const where = {
    ...(q
      ? {
          OR: [
            { email: { contains: q, mode: 'insensitive' as const } },
            { name: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    // 가입 경로(utm_source) 필터
    ...(source ? { signupSource: { path: ['utm_source'], equals: source } } : {}),
    ...(role === 'operator' ? { platformRole: 'OPERATOR' as const } : {}),
    ...(role === 'user' ? { platformRole: null } : {}),
    ...(spaces === 'some' ? { spaceMemberships: { some: {} } } : {}),
    ...(spaces === 'none' ? { spaceMemberships: { none: {} } } : {}),
    // 운영자는 mfaRequired 와 무관하게 항상 2단계 인증 필수 — q 검색의 OR 와 겹치지 않게 AND 로 묶는다
    ...(mfa === 'required'
      ? { AND: [{ OR: [{ mfaRequired: true }, { platformRole: 'OPERATOR' as const }] }] }
      : {}),
    ...(mfa === 'off' ? { mfaRequired: false, platformRole: null } : {}),
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: [SORTS[sortKey](dir), { id: 'asc' }],
    take: PAGE_SIZE + 1,
    skip: offset,
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      platformRole: true,
      mfaRequired: true,
      signupSource: true,
      spaceMemberships: {
        select: {
          role: true,
          space: { select: { id: true, name: true } },
        },
      },
    },
  })

  const hasMore = users.length > PAGE_SIZE
  const page = hasMore ? users.slice(0, PAGE_SIZE) : users

  // 조회 실패(null)면 모든 행 totpEnrolled null — UI 는 「—」 표시
  const enrolled = await getVerifiedTotpUserIds(page.map((u) => u.id))

  return NextResponse.json({
    users: page.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      signupSource: u.signupSource,
      isOperator: u.platformRole === 'OPERATOR',
      mfaRequired: u.mfaRequired,
      totpEnrolled: enrolled ? enrolled.has(u.id) : null,
      spaceMemberships: u.spaceMemberships.map((m) => ({
        spaceId: m.space.id,
        spaceName: m.space.name,
        role: m.role,
      })),
    })),
    nextOffset: hasMore ? offset + page.length : null,
  })
}
