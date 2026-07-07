import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { positionSchema } from '@/lib/validations/hiring-posts'

// 직무 기준정보 목록 (?activeOnly)
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true'
  const positions = await prisma.hiringPosition.findMany({
    where: { spaceId: resolved.space.id, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ positions })
}

// 직무 기준정보 생성
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('recruiting')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = positionSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const position = await prisma.hiringPosition.create({
    data: {
      spaceId: resolved.space.id,
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  })
  return NextResponse.json({ position }, { status: 201 })
}
