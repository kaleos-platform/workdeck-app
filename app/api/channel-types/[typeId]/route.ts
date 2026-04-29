import { NextRequest, NextResponse } from 'next/server'
import { resolveAnyDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { channelTypeDefSchema } from '@/lib/sh/schemas'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ typeId: string }> }) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { typeId } = await params

  const existing = await prisma.channelTypeDef.findFirst({
    where: { id: typeId, spaceId: resolved.space.id },
    select: { id: true, isSystem: true },
  })
  if (!existing) return errorResponse('채널 유형을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = channelTypeDefSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // 시스템 시드는 isSalesChannel · sortOrder 만 변경 가능 (이름 보존)
  const data: Record<string, unknown> = {}
  if (parsed.data.isSalesChannel !== undefined) data.isSalesChannel = parsed.data.isSalesChannel
  if (parsed.data.sortOrder !== undefined) data.sortOrder = parsed.data.sortOrder
  if (parsed.data.name !== undefined && !existing.isSystem) data.name = parsed.data.name.trim()

  try {
    const updated = await prisma.channelTypeDef.update({
      where: { id: typeId },
      data,
    })
    return NextResponse.json({ type: updated })
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ typeId: string }> }
) {
  const resolved = await resolveAnyDeckContext(['seller-hub', 'coupang-ads'])
  if ('error' in resolved) return resolved.error

  const { typeId } = await params

  const existing = await prisma.channelTypeDef.findFirst({
    where: { id: typeId, spaceId: resolved.space.id },
    include: { _count: { select: { channels: true } } },
  })
  if (!existing) return errorResponse('채널 유형을 찾을 수 없습니다', 404)
  if (existing.isSystem) return errorResponse('시스템 유형은 삭제할 수 없습니다', 400)
  if (existing._count.channels > 0) {
    return errorResponse(
      `이 유형을 사용 중인 채널이 ${existing._count.channels}개 있어 삭제할 수 없습니다`,
      409
    )
  }

  await prisma.channelTypeDef.delete({ where: { id: typeId } })
  return new NextResponse(null, { status: 204 })
}
