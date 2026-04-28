import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelTypeDefSchema } from '@/lib/sh/schemas'

export async function GET() {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const types = await prisma.channelTypeDef.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      _count: { select: { channels: true } },
    },
  })

  return NextResponse.json({
    types: types.map((t) => ({
      id: t.id,
      name: t.name,
      isSalesChannel: t.isSalesChannel,
      isSystem: t.isSystem,
      sortOrder: t.sortOrder,
      channelCount: t._count.channels,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelTypeDefSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const created = await prisma.channelTypeDef.create({
      data: {
        spaceId: resolved.space.id,
        name: parsed.data.name.trim(),
        isSalesChannel: parsed.data.isSalesChannel,
        sortOrder: parsed.data.sortOrder ?? 99,
        isSystem: false,
      },
    })
    return NextResponse.json({ type: created }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 채널 유형명이 존재합니다', 409)
    }
    throw err
  }
}
