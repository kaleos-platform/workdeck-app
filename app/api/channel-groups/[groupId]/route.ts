import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelGroupSchema } from '@/lib/sh/schemas'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { groupId } = await params

  const existing = await prisma.channelGroup.findFirst({
    where: { id: groupId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널 그룹을 찾을 수 없습니다', 404)

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
    const group = await prisma.channelGroup.update({
      where: { id: groupId },
      data: { name: parsed.data.name },
    })
    return NextResponse.json({ group })
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { groupId } = await params

  const existing = await prisma.channelGroup.findFirst({
    where: { id: groupId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널 그룹을 찾을 수 없습니다', 404)

  // 해당 그룹 소속 채널의 groupId는 onDelete: SetNull로 자동 null 처리됨
  await prisma.channelGroup.delete({ where: { id: groupId } })

  return new NextResponse(null, { status: 204 })
}
