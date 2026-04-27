import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { salesContentChannelInputSchema } from '@/lib/sc/schemas'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const channel = await prisma.salesContentChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)
  return NextResponse.json({ channel })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.salesContentChannel.findFirst({
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

  const parsed = salesContentChannelInputSchema.partial().safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const updated = await prisma.salesContentChannel.update({
      where: { id },
      data: {
        name: parsed.data.name ?? undefined,
        platformSlug: parsed.data.platformSlug ?? undefined,
        platform: parsed.data.platform ?? undefined,
        kind: parsed.data.kind ?? undefined,
        publisherMode: parsed.data.publisherMode ?? undefined,
        collectorMode: parsed.data.collectorMode ?? undefined,
        isActive: parsed.data.isActive ?? undefined,
        config: (parsed.data.config ?? undefined) as never,
      },
    })
    return NextResponse.json({ channel: updated })
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return errorResponse('이미 동일한 platformSlug 의 채널이 존재합니다', 409)
    }
    throw err
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id } = await params
  const existing = await prisma.salesContentChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!existing) return errorResponse('채널을 찾을 수 없습니다', 404)

  await prisma.salesContentChannel.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
