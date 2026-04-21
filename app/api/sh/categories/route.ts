import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/sh/categories?includeProductCount=true
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const includeCount = req.nextUrl.searchParams.get('includeProductCount') === 'true'

  const categories = await prisma.invProductGroup.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
    include: includeCount ? { _count: { select: { products: true } } } : undefined,
  })

  return NextResponse.json({
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      ...(includeCount && '_count' in c
        ? { productCount: (c as typeof c & { _count: { products: number } })._count.products }
        : {}),
    })),
  })
}

// POST /api/sh/categories
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: { name?: string }
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 본문입니다', 400)
  }

  const name = body.name?.trim()
  if (!name) return errorResponse('카테고리명은 필수입니다', 400)
  if (name.length > 100) return errorResponse('카테고리명은 100자 이내여야 합니다', 400)

  // 중복 검사
  const existing = await prisma.invProductGroup.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (existing) return errorResponse('이미 존재하는 카테고리명입니다', 409)

  const category = await prisma.invProductGroup.create({
    data: { spaceId: resolved.space.id, name },
  })

  return NextResponse.json({ category }, { status: 201 })
}
