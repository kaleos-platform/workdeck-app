import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { storeSchema } from '@/lib/validations/hiring-posts'

// 매장 기준정보 목록 (?activeOnly)
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error

  const activeOnly = req.nextUrl.searchParams.get('activeOnly') === 'true'
  const stores = await prisma.hiringStore.findMany({
    where: { spaceId: resolved.space.id, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ stores })
}

// 매장 기준정보 생성
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = storeSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const store = await prisma.hiringStore.create({
    data: {
      spaceId: resolved.space.id,
      name: parsed.data.name,
      roadAddress: parsed.data.roadAddress ?? null,
      detailAddress: parsed.data.detailAddress ?? null,
      zipcode: parsed.data.zipcode ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  })
  return NextResponse.json({ store }, { status: 201 })
}
