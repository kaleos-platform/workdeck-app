import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { saveBoCredential, deleteBoCredential } from '@/lib/bo/credentials'

type Params = { params: Promise<{ id: string }> }

// GET /api/bo/channels/[id]/credentials — 메타데이터만 반환 (페이로드 절대 노출 금지)
export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  // spaceId 범위 확인 (IDOR 방어)
  const channel = await prisma.boChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  const credentials = await prisma.boChannelCredential.findMany({
    where: { channelId: id },
    select: {
      id: true,
      kind: true,
      expiresAt: true,
      lastVerifiedAt: true,
      lastError: true,
      updatedAt: true,
    },
  })

  return NextResponse.json({
    credentials: credentials.map((c) => ({
      id: c.id,
      kind: c.kind as string,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null,
      lastError: c.lastError,
      updatedAt: c.updatedAt.toISOString(),
    })),
  })
}

const saveSchema = z.object({
  kind: z.enum(['COOKIE', 'OAUTH', 'API_KEY']),
  payload: z.record(z.string(), z.unknown()),
  expiresAt: z.string().datetime().optional().nullable(),
})

// POST /api/bo/channels/[id]/credentials — 자격증명 등록/갱신 (AES-256-CBC 암호화 저장)
export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const channel = await prisma.boChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { errors: parsed.error.flatten() })
  }

  const { kind, payload, expiresAt } = parsed.data

  await saveBoCredential({
    channelId: id,
    spaceId: resolved.space.id,
    kind,
    payload,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}

const deleteSchema = z.object({
  kind: z.enum(['COOKIE', 'OAUTH', 'API_KEY']),
})

// DELETE /api/bo/channels/[id]/credentials — 자격증명 삭제
export async function DELETE(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('blog-ops')
  if ('error' in resolved) return resolved.error

  const { id } = await params

  const channel = await prisma.boChannel.findFirst({
    where: { id, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!channel) return errorResponse('채널을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('입력값이 올바르지 않습니다', 400, { errors: parsed.error.flatten() })
  }

  try {
    await deleteBoCredential(id, parsed.data.kind)
  } catch {
    return errorResponse('자격증명을 찾을 수 없습니다', 404)
  }

  return new NextResponse(null, { status: 204 })
}
