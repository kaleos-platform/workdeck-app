import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const spaceId = resolved.space.id

  const [brand, product, channel, location, shippingMethod, space] = await Promise.all([
    prisma.brand.count({ where: { spaceId } }),
    prisma.invProduct.count({ where: { spaceId } }),
    prisma.channel.count({ where: { spaceId } }),
    prisma.invStorageLocation.count({ where: { spaceId } }),
    prisma.delShippingMethod.count({ where: { spaceId } }),
    prisma.space.findUnique({
      where: { id: spaceId },
      select: { onboardingDismissedAt: true },
    }),
  ])

  const counts = { brand, product, channel, location, shippingMethod }
  const completed =
    brand >= 1 && product >= 1 && channel >= 1 && location >= 1 && shippingMethod >= 1
  const dismissed = space?.onboardingDismissedAt != null

  return NextResponse.json({ counts, completed, dismissed })
}

export async function PATCH(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const dismissed = (body as { dismissed?: unknown })?.dismissed === true
  if (!dismissed) {
    return errorResponse('dismissed=true 만 지원합니다', 400)
  }

  await prisma.space.update({
    where: { id: resolved.space.id },
    data: { onboardingDismissedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
