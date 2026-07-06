import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { storeSchema } from '@/lib/validations/hiring-posts'

type Params = { params: Promise<{ id: string }> }

// 매장 기준정보 수정
export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringStore.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('매장을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = storeSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const store = await prisma.hiringStore.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.roadAddress !== undefined && {
        roadAddress: parsed.data.roadAddress ?? null,
      }),
      ...(parsed.data.detailAddress !== undefined && {
        detailAddress: parsed.data.detailAddress ?? null,
      }),
      ...(parsed.data.zipcode !== undefined && { zipcode: parsed.data.zipcode ?? null }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
    },
  })
  return NextResponse.json({ store })
}

// 매장 기준정보 삭제
export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('hiring-posts')
  if ('error' in resolved) return resolved.error
  const { id } = await params

  const existing = await prisma.hiringStore.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('매장을 찾을 수 없습니다', 404)

  await prisma.hiringStore.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
