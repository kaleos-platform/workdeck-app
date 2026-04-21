import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { brandSchema } from '@/lib/sh/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const brands = await prisma.brand.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ brands })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = brandSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const brand = await prisma.brand.create({
      data: {
        spaceId: resolved.space.id,
        name: parsed.data.name,
        logoUrl: parsed.data.logoUrl ?? null,
        memo: parsed.data.memo ?? null,
      },
    })
    return NextResponse.json({ brand }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 브랜드명이 존재합니다', 409)
    }
    throw err
  }
}
