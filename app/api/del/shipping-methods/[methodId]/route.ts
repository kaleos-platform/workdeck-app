import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ methodId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { methodId } = await params
  const method = await prisma.delShippingMethod.findUnique({
    where: { id: methodId },
  })
  if (!method || method.spaceId !== resolved.space.id) {
    return errorResponse('배송 방식을 찾을 수 없습니다', 404)
  }

  return NextResponse.json({ method })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { methodId } = await params
  const method = await prisma.delShippingMethod.findUnique({
    where: { id: methodId },
    select: { spaceId: true },
  })
  if (!method || method.spaceId !== resolved.space.id) {
    return errorResponse('배송 방식을 찾을 수 없습니다', 404)
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (typeof body?.name === 'string' && body.name.trim()) {
    const name = body.name.trim()
    const duplicate = await prisma.delShippingMethod.findFirst({
      where: { spaceId: resolved.space.id, name, id: { not: methodId } },
    })
    if (duplicate) return errorResponse('이미 존재하는 배송 방식 이름입니다', 409)
    data.name = name
  }

  if (Array.isArray(body?.formatConfig) && body.formatConfig.length > 0) {
    data.formatConfig = body.formatConfig
  }
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive

  const updated = await prisma.delShippingMethod.update({
    where: { id: methodId },
    data,
  })

  return NextResponse.json({ method: updated })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const { methodId } = await params
  const method = await prisma.delShippingMethod.findUnique({
    where: { id: methodId },
    select: { spaceId: true },
  })
  if (!method || method.spaceId !== resolved.space.id) {
    return errorResponse('배송 방식을 찾을 수 없습니다', 404)
  }

  // soft delete
  await prisma.delShippingMethod.update({
    where: { id: methodId },
    data: { isActive: false },
  })

  return NextResponse.json({ success: true })
}
