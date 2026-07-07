import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createBoMaterialBodySchema } from '@/lib/bo/ideation-schemas'

const listQuerySchema = z.object({
  status: z.enum(['PROPOSED', 'APPROVED', 'REJECTED', 'ARCHIVED']).optional(),
  productId: z.string().optional(),
})

// GET /api/bo/materials — 소재 목록 (status · productId 필터)
export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { searchParams } = new URL(req.url)
  const query = listQuerySchema.safeParse({
    status: searchParams.get('status') ?? undefined,
    productId: searchParams.get('productId') ?? undefined,
  })
  if (!query.success) {
    return errorResponse('invalid query', 400, { errors: query.error.flatten() })
  }

  const materials = await prisma.boMaterial.findMany({
    where: {
      spaceId: resolved.space.id,
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.productId ? { productId: query.data.productId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      appealPoint: true,
      angle: true,
      outline: true,
      targetKeyword: true,
      status: true,
      approvedByUserId: true,
      approvedAt: true,
      createdAt: true,
      updatedAt: true,
      product: { select: { id: true, name: true } },
      ideation: { select: { id: true } },
    },
  })

  return NextResponse.json({ materials })
}

// POST /api/bo/materials — 소재 수동 등록 (status=PROPOSED)
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = createBoMaterialBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // productId가 이 공간에 속하는지 검증 (IDOR 방어)
  const product = await prisma.boProduct.findFirst({
    where: { id: parsed.data.productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) {
    return errorResponse('해당 제품을 찾을 수 없습니다', 404)
  }

  const material = await prisma.boMaterial.create({
    data: {
      spaceId: resolved.space.id,
      productId: parsed.data.productId,
      ideationId: parsed.data.ideationId ?? null,
      title: parsed.data.title,
      appealPoint: parsed.data.appealPoint,
      angle: parsed.data.angle,
      outline: parsed.data.outline as never,
      targetKeyword: parsed.data.targetKeyword ?? null,
      status: 'PROPOSED',
    },
    select: { id: true, status: true, createdAt: true },
  })

  return NextResponse.json({ material }, { status: 201 })
}
