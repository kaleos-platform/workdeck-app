import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const groups = await prisma.invProductGroup.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  })

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      productCount: g._count.products,
      createdAt: g.createdAt,
    })),
  })
}

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
  if (!name) return errorResponse('그룹명은 필수입니다', 400)

  // Check duplicate
  const existing = await prisma.invProductGroup.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (existing) return errorResponse('이미 존재하는 그룹명입니다', 409)

  const group = await prisma.invProductGroup.create({
    data: { spaceId: resolved.space.id, name },
  })

  return NextResponse.json({ group }, { status: 201 })
}
