import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { salesContentChannelInputSchema } from '@/lib/sc/schemas'

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const channels = await prisma.salesContentChannel.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
  return NextResponse.json({ channels })
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

  const parsed = salesContentChannelInputSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  try {
    const created = await prisma.salesContentChannel.create({
      data: {
        spaceId: resolved.space.id,
        name: parsed.data.name,
        platformSlug: parsed.data.platformSlug,
        platform: parsed.data.platform,
        kind: parsed.data.kind,
        publisherMode: parsed.data.publisherMode ?? 'MANUAL',
        collectorMode: parsed.data.collectorMode ?? 'MANUAL',
        isActive: parsed.data.isActive ?? true,
        config: (parsed.data.config ?? undefined) as never,
      },
    })
    return NextResponse.json({ channel: created }, { status: 201 })
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
