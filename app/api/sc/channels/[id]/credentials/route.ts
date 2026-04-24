import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deleteChannelCredential, upsertChannelCredential } from '@/lib/sc/credentials'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  kind: z.enum(['COOKIE', 'OAUTH', 'API_KEY']),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: z.string().datetime().optional(),
})

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id: channelId } = await params
  const rows = await prisma.channelCredential.findMany({
    where: { channelId, spaceId: resolved.space.id },
    select: {
      id: true,
      kind: true,
      expiresAt: true,
      lastVerifiedAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return NextResponse.json({ credentials: rows })
}

// POST: 새 자격증명 저장 (upsert — kind 단위 1개). payload 는 복호화 없이 반환하지 않음.
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id: channelId } = await params
  const channel = await prisma.salesContentChannel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }

  const saved = await upsertChannelCredential({
    spaceId: resolved.space.id,
    channelId,
    kind: parsed.data.kind,
    payload: parsed.data.payload,
    expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
  })

  return NextResponse.json(
    {
      credential: {
        id: saved.id,
        kind: saved.kind,
        expiresAt: saved.expiresAt,
        updatedAt: saved.updatedAt,
      },
    },
    { status: 201 }
  )
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const { id: channelId } = await params
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') as 'COOKIE' | 'OAUTH' | 'API_KEY' | null
  if (!kind) return errorResponse('kind 가 필요합니다', 400)

  const channel = await prisma.salesContentChannel.findFirst({
    where: { id: channelId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  try {
    await deleteChannelCredential(channelId, kind)
    return NextResponse.json({ ok: true })
  } catch {
    return errorResponse('자격증명을 찾을 수 없습니다', 404)
  }
}
