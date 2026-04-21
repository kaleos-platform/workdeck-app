import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelGroupSchema } from '@/lib/sh/schemas'

export async function GET() {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const groups = await prisma.channelGroup.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { name: 'asc' },
    include: {
      channels: {
        select: { id: true, name: true, kind: true, isActive: true },
        orderBy: { name: 'asc' },
      },
    },
  })

  return NextResponse.json({ groups })
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

  const parsed = channelGroupSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const group = await prisma.channelGroup.create({
      data: {
        spaceId: resolved.space.id,
        name: parsed.data.name,
      },
    })
    return NextResponse.json({ group }, { status: 201 })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 채널 그룹명이 존재합니다', 409)
    }
    throw err
  }
}
