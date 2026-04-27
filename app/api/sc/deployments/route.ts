import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deploymentCreateSchema } from '@/lib/sc/schemas'
import { deriveUtmDefaults, generateShortSlug, normalizeKebab } from '@/lib/sc/utm'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const deployments = await prisma.contentDeployment.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      content: { select: { id: true, title: true, status: true } },
      channel: { select: { id: true, name: true, platform: true, platformSlug: true, kind: true } },
      _count: { select: { clickEvents: true } },
    },
  })
  return NextResponse.json({ deployments })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = deploymentCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  // content + channel 검증 (space scope)
  const [content, channel] = await Promise.all([
    prisma.content.findFirst({
      where: { id: parsed.data.contentId, spaceId: resolved.space.id },
      select: { id: true, title: true },
    }),
    prisma.salesContentChannel.findFirst({
      where: { id: parsed.data.channelId, spaceId: resolved.space.id },
      select: { id: true, kind: true, platformSlug: true },
    }),
  ])
  if (!content) return errorResponse('콘텐츠를 찾을 수 없습니다', 404)
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const utmDefaults = deriveUtmDefaults({
    channelPlatformSlug: channel.platformSlug,
    channelKind: channel.kind,
    campaignSlug: parsed.data.utmCampaign ?? null,
    contentTitle: content.title,
  })

  // slug 충돌 대비 — 최대 5 회 재시도.
  let lastError: unknown
  for (let i = 0; i < 5; i++) {
    const slug = generateShortSlug()
    try {
      const created = await prisma.contentDeployment.create({
        data: {
          spaceId: resolved.space.id,
          contentId: parsed.data.contentId,
          channelId: parsed.data.channelId,
          shortSlug: slug,
          targetUrl: parsed.data.targetUrl,
          scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
          utmSource: parsed.data.utmSource
            ? normalizeKebab(parsed.data.utmSource)
            : utmDefaults.utmSource,
          utmMedium: parsed.data.utmMedium
            ? normalizeKebab(parsed.data.utmMedium)
            : utmDefaults.utmMedium,
          utmCampaign: parsed.data.utmCampaign
            ? normalizeKebab(parsed.data.utmCampaign)
            : utmDefaults.utmCampaign,
          utmContent: parsed.data.utmContent ? normalizeKebab(parsed.data.utmContent) : null,
          utmTerm: parsed.data.utmTerm ? normalizeKebab(parsed.data.utmTerm) : null,
        },
      })
      return NextResponse.json({ deployment: created }, { status: 201 })
    } catch (err: unknown) {
      lastError = err
      const code =
        typeof err === 'object' && err != null && 'code' in err
          ? (err as { code: string }).code
          : null
      if (code === 'P2002') continue // slug 충돌 → 재시도
      throw err
    }
  }
  return errorResponse('shortSlug 생성에 5회 연속 실패했습니다', 500, {
    detail: lastError instanceof Error ? lastError.message : String(lastError),
  })
}
