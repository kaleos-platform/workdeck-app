import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { createChannelBodySchema } from '@/lib/bo/channel-schemas'
import { DEFAULT_PROFILES } from '@/lib/bo/channel-profiles'
import type { BoPlatform } from '@/generated/prisma/client'
import type { Prisma } from '@/generated/prisma/client'

// GET /api/bo/channels — 채널 목록
export async function GET() {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const channels = await prisma.boChannel.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'asc' },
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

  return NextResponse.json({ channels })
}

// POST /api/bo/channels — 채널 생성 (포맷 프로필 미제공 시 플랫폼 기본값 사용)
export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = createChannelBodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { errors: parsed.error.flatten() })
  }

  const { platform, name, formatProfile, publisherMode, config } = parsed.data

  // 미제공 시 플랫폼 기본 프로필 사용
  const profileToSave = formatProfile ?? DEFAULT_PROFILES[platform as BoPlatform]

  try {
    const channel = await prisma.boChannel.create({
      data: {
        spaceId: resolved.space.id,
        platform: platform as BoPlatform,
        name,
        formatProfile: profileToSave as unknown as Prisma.InputJsonValue,
        publisherMode: publisherMode ?? 'MANUAL',
        config: config ? (config as Prisma.InputJsonValue) : undefined,
      },
      select: {
        id: true,
        platform: true,
        name: true,
        formatProfile: true,
        publisherMode: true,
        isActive: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ channel }, { status: 201 })
  } catch (err) {
    // @@unique([spaceId, platform, name]) 위반
    if (
      err instanceof Error &&
      err.message.includes('Unique constraint') &&
      err.message.includes('platform')
    ) {
      return errorResponse('같은 플랫폼에 동일한 이름의 채널이 이미 있습니다', 409)
    }
    throw err
  }
}
