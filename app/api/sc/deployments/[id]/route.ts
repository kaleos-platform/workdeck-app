import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deploymentUpdateSchema } from '@/lib/sc/schemas'
import { normalizeKebab } from '@/lib/sc/utm'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const deployment = await prisma.contentDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    include: {
      content: { select: { id: true, title: true, status: true } },
      channel: { select: { id: true, name: true, platform: true, platformSlug: true, kind: true } },
      _count: { select: { clickEvents: true } },
    },
  })
  if (!deployment) return errorResponse('배포를 찾을 수 없습니다', 404)

  return NextResponse.json({ deployment })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.contentDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('배포를 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = deploymentUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const updated = await prisma.contentDeployment.update({
    where: { id },
    data: {
      targetUrl: parsed.data.targetUrl ?? undefined,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : undefined,
      status: parsed.data.status ?? undefined,
      platformUrl: parsed.data.platformUrl ?? undefined,
      utmSource: parsed.data.utmSource ? normalizeKebab(parsed.data.utmSource) : undefined,
      utmMedium: parsed.data.utmMedium ? normalizeKebab(parsed.data.utmMedium) : undefined,
      utmCampaign: parsed.data.utmCampaign ? normalizeKebab(parsed.data.utmCampaign) : undefined,
      utmContent: parsed.data.utmContent ? normalizeKebab(parsed.data.utmContent) : undefined,
      utmTerm: parsed.data.utmTerm ? normalizeKebab(parsed.data.utmTerm) : undefined,
    },
  })
  return NextResponse.json({ deployment: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.contentDeployment.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('배포를 찾을 수 없습니다', 404)

  await prisma.contentDeployment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
