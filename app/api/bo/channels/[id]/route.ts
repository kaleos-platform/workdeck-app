import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { updateChannelBodySchema } from '@/lib/bo/channel-schemas'
import type { Prisma } from '@/generated/prisma/client'

// GET /api/bo/channels/[id] — 채널 단건 조회
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const channel = await prisma.boChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: {
      id: true,
      platform: true,
      name: true,
      formatProfile: true,
      publisherMode: true,
      isActive: true,
      config: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  return NextResponse.json({ channel })
}

// PATCH /api/bo/channels/[id] — 채널 수정 (name / formatProfile / isActive / publisherMode / config)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // spaceId 범위 내 존재 확인 (IDOR 방어)
  const existing = await prisma.boChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = updateChannelBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { errors: parsed.error.flatten() })
  }

  const { name, formatProfile, isActive, publisherMode, config } = parsed.data

  const updateData: Prisma.BoChannelUpdateInput = {}
  if (name !== undefined) updateData.name = name
  if (formatProfile !== undefined)
    updateData.formatProfile = formatProfile as unknown as Prisma.InputJsonValue
  if (isActive !== undefined) updateData.isActive = isActive
  if (publisherMode !== undefined) updateData.publisherMode = publisherMode
  if (config !== undefined) updateData.config = config as Prisma.InputJsonValue

  try {
    const channel = await prisma.boChannel.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        platform: true,
        name: true,
        formatProfile: true,
        publisherMode: true,
        isActive: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ channel })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique constraint')) {
      return errorResponse('같은 플랫폼에 동일한 이름의 채널이 이미 있습니다', 409)
    }
    throw err
  }
}

// DELETE /api/bo/channels/[id] — 채널 비활성화 (소프트 삭제)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const existing = await prisma.boChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  await prisma.boChannel.update({
    where: { id },
    data: { isActive: false },
  })

  return new NextResponse(null, { status: 204 })
}
