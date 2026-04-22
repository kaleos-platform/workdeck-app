import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { sanitizeOverrides } from '@/lib/del/label-overrides'

type Params = { params: Promise<{ methodId: string; optionId: string }> }

/**
 * PUT body: { overrides: Record<DelFieldMapping, string> }
 * - 빈 overrides 로 보내면 레코드 삭제 (사용자가 모든 필드 해제한 경우)
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { methodId, optionId } = await params

  // 소유권 검증 — method + option 모두 동일 space
  const [method, option] = await Promise.all([
    prisma.delShippingMethod.findFirst({
      where: { id: methodId, spaceId: resolved.space.id },
      select: { id: true },
    }),
    prisma.invProductOption.findFirst({
      where: { id: optionId, product: { spaceId: resolved.space.id } },
      select: { id: true },
    }),
  ])
  if (!method) return errorResponse('배송 방식을 찾을 수 없습니다', 404)
  if (!option) return errorResponse('옵션을 찾을 수 없습니다', 404)

  const body = await req.json().catch(() => ({}))
  const overrides = sanitizeOverrides(body?.overrides)

  if (Object.keys(overrides).length === 0) {
    await prisma.delShippingMethodLabel.deleteMany({
      where: { shippingMethodId: methodId, optionId },
    })
    return NextResponse.json({ ok: true, deleted: true, overrides: {} })
  }

  const label = await prisma.delShippingMethodLabel.upsert({
    where: {
      shippingMethodId_optionId: { shippingMethodId: methodId, optionId },
    },
    update: { overrides },
    create: {
      spaceId: resolved.space.id,
      shippingMethodId: methodId,
      optionId,
      overrides,
    },
    select: { id: true, overrides: true, updatedAt: true },
  })

  return NextResponse.json({ ok: true, deleted: false, label })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { methodId, optionId } = await params

  // space 검증 — 존재 안 해도 idempotent
  const method = await prisma.delShippingMethod.findFirst({
    where: { id: methodId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!method) return errorResponse('배송 방식을 찾을 수 없습니다', 404)

  await prisma.delShippingMethodLabel.deleteMany({
    where: { shippingMethodId: methodId, optionId },
  })

  return NextResponse.json({ ok: true })
}
