import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const isActiveParam = req.nextUrl.searchParams.get('isActive')
  const where: { spaceId: string; isActive?: boolean } = {
    spaceId: resolved.space.id,
  }
  if (isActiveParam === 'true') where.isActive = true
  else if (isActiveParam === 'false') where.isActive = false

  const methods = await prisma.delShippingMethod.findMany({
    where,
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ methods })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const formatConfig = body?.formatConfig

  if (!name) return errorResponse('배송 방식 이름이 필요합니다', 400)
  if (!Array.isArray(formatConfig) || formatConfig.length === 0) {
    return errorResponse('포맷 설정이 필요합니다', 400)
  }

  const duplicate = await prisma.delShippingMethod.findFirst({
    where: { spaceId: resolved.space.id, name },
  })
  if (duplicate) return errorResponse('이미 존재하는 배송 방식 이름입니다', 409)

  const method = await prisma.delShippingMethod.create({
    data: {
      spaceId: resolved.space.id,
      name,
      formatConfig,
    },
  })

  return NextResponse.json({ method }, { status: 201 })
}
