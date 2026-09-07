import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'

const PAGE_SIZE = 50

// GET /api/admin/users — 검색(email·name 부분일치) + 커서 페이지네이션
export async function GET(request: NextRequest) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim()
  const cursor = url.searchParams.get('cursor')

  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: 'insensitive' as const } },
          { name: { contains: q, mode: 'insensitive' as const } },
        ],
      }
    : undefined

  const users = await prisma.user.findMany({
    where,
    orderBy: { id: 'asc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      platformRole: true,
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

  return NextResponse.json({
    users: page.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      isOperator: u.platformRole === 'OPERATOR',
      spaceMemberships: u.spaceMemberships.map((m) => ({
        spaceId: m.space.id,
        spaceName: m.space.name,
        role: m.role,
      })),
    })),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}
