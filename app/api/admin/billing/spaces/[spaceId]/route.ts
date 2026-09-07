import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// GET /api/admin/billing/spaces/[spaceId] — Space 결제 상세
// 카드 원문(billingKey/billingKeyIv)은 절대 응답에 포함하지 않는다 — select로 명시 제외
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { spaceId } = await params

  const space = await prisma.space.findUnique({
    where: { id: spaceId },
    select: { id: true, name: true },
  })
  if (!space) return errorResponse('Space를 찾을 수 없습니다', 404)

  const [subscription, methods, charges] = await Promise.all([
    prisma.spaceSubscription.findUnique({
      where: { spaceId },
      include: { items: { orderBy: { addedAt: 'asc' } } },
    }),
    prisma.billingMethod.findMany({
      where: { spaceId },
      select: {
        id: true,
        provider: true,
        cardSummary: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.billingCharge.findMany({
      where: { spaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  return NextResponse.json({ space, subscription, methods, charges })
}
