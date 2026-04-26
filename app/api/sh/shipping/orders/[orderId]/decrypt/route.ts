import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { decryptOrderPii } from '@/lib/del/encryption'

type Params = { params: Promise<{ orderId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId } = await params
  const order = await prisma.delOrder.findUnique({
    where: { id: orderId },
    select: {
      spaceId: true,
      recipientNameEnc: true,
      recipientNameIv: true,
      phoneEnc: true,
      phoneIv: true,
      addressEnc: true,
      addressIv: true,
    },
  })
  if (!order || order.spaceId !== resolved.space.id) {
    return errorResponse('주문을 찾을 수 없습니다', 404)
  }

  try {
    const pii = decryptOrderPii(order)
    return NextResponse.json(pii)
  } catch {
    return errorResponse('복호화에 실패했습니다', 500)
  }
}
