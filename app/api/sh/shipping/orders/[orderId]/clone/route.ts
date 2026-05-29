import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { MAX_ITEMS_PER_ORDER } from '@/lib/sh/shipping-constants'

type Params = { params: Promise<{ orderId: string }> }

/**
 * POST /api/sh/shipping/orders/[orderId]/clone
 *
 * 완료된 배송 건을 현재 DRAFT 묶음에 복제 등록(재주문/재배송).
 * PII는 암호문(Enc/Iv) 그대로 복사 — 복호화하지 않으므로 평문이 노출되지 않는다.
 * 주문번호는 비우고(재주문), 주문일자는 오늘로 설정한다.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { orderId } = await params
  const source = await prisma.delOrder.findUnique({
    where: { id: orderId },
    select: {
      spaceId: true,
      shippingMethodId: true,
      channelId: true,
      recipientNameEnc: true,
      recipientNameIv: true,
      phoneEnc: true,
      phoneIv: true,
      addressEnc: true,
      addressIv: true,
      postalCode: true,
      deliveryMessage: true,
      memo: true,
      paymentAmount: true,
      items: { select: { name: true, quantity: true } },
    },
  })
  if (!source || source.spaceId !== resolved.space.id) {
    return errorResponse('주문을 찾을 수 없습니다', 404)
  }

  // 현재 DRAFT 묶음 확보 — 없으면 생성 (등록 화면 loadBaseData 패턴)
  let batch = await prisma.delBatch.findFirst({
    where: { spaceId: resolved.space.id, status: 'DRAFT' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!batch) {
    batch = await prisma.delBatch.create({
      data: { spaceId: resolved.space.id },
      select: { id: true },
    })
  }

  const cloned = await prisma.delOrder.create({
    data: {
      spaceId: resolved.space.id,
      batchId: batch.id,
      shippingMethodId: source.shippingMethodId,
      channelId: source.channelId,
      // PII 암호문 그대로 복사 (복호화 없음)
      recipientNameEnc: source.recipientNameEnc,
      recipientNameIv: source.recipientNameIv,
      phoneEnc: source.phoneEnc,
      phoneIv: source.phoneIv,
      addressEnc: source.addressEnc,
      addressIv: source.addressIv,
      postalCode: source.postalCode,
      deliveryMessage: source.deliveryMessage,
      memo: source.memo,
      paymentAmount: source.paymentAmount,
      // 재주문: 주문번호 비움 + 주문일자 오늘
      orderNumber: null,
      orderDate: new Date(),
      items: {
        create: source.items
          .slice(0, MAX_ITEMS_PER_ORDER)
          .map((it) => ({ name: it.name, quantity: it.quantity })),
      },
    },
    select: { id: true },
  })

  return NextResponse.json(
    { success: true, batchId: batch.id, orderId: cloned.id },
    { status: 201 }
  )
}
