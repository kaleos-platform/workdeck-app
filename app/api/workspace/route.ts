import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'

// POST /api/workspace — 워크스페이스 생성 (1인 1워크스페이스)
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  // 이미 워크스페이스가 존재하는지 확인
  const existing = await prisma.workspace.findUnique({
    where: { ownerId: user.id },
  })
  if (existing) {
    return errorResponse('이미 워크스페이스가 존재합니다', 409)
  }

  const body = await request.json()
  const { name } = body
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return errorResponse('워크스페이스 이름을 입력해주세요', 400)
  }

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

  // 워크스페이스 생성
  const workspace = await prisma.workspace.create({
    data: {
      name: name.trim(),
      ownerId: user.id,
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
    },
  })

  return NextResponse.json(workspace, { status: 201 })
}
