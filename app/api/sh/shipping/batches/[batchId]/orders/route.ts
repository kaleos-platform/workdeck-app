import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { decryptPii } from '@/lib/del/encryption'
import { maskName, maskPhone, maskAddress } from '@/lib/del/pii-masker'

type Params = { params: Promise<{ batchId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { batchId } = await params
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true, status: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page')) || 1)
  const pageSize = Math.min(
    100,
    Math.max(1, Number(req.nextUrl.searchParams.get('pageSize')) || 50)
  )
  const decrypt = req.nextUrl.searchParams.get('decrypt') === 'true'

  const where = { batchId, spaceId: resolved.space.id }

  const [orders, total] = await Promise.all([
    prisma.delOrder.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        items: {
          include: {
            option: {
              select: {
                id: true,
                name: true,
                product: { select: { id: true, name: true } },
              },
            },
          },
        },
        channel: { select: { id: true, name: true } },
        shippingMethod: { select: { id: true, name: true } },
      },
    }),
    prisma.delOrder.count({ where }),
  ])

  const data = orders.map((order) => {
    // DRAFT 배송 묶음이거나 명시적 복호화 요청 시에만 전체 데이터 반환
    const shouldDecrypt = batch.status === 'DRAFT' || decrypt
    let recipientName: string
    let phone: string
    let address: string

    try {
      const pii = decryptPii(order.recipientNameEnc, order.recipientNameIv)
      const phoneVal = decryptPii(order.phoneEnc, order.phoneIv)
      const addrVal = decryptPii(order.addressEnc, order.addressIv)

      if (shouldDecrypt) {
        recipientName = pii
        phone = phoneVal
        address = addrVal
      } else {
        recipientName = maskName(pii)
        phone = maskPhone(phoneVal)
        address = maskAddress(addrVal)
      }
    } catch {
      // 복호화 실패 시 안전한 플레이스홀더 반환
      recipientName = '[복호화 오류]'
      phone = '[복호화 오류]'
      address = '[복호화 오류]'
    }

    return {
      id: order.id,
      recipientName,
      phone,
      address,
      postalCode: order.postalCode,
      deliveryMessage: order.deliveryMessage,
      memo: order.memo,
      orderDate: order.orderDate,
      orderNumber: order.orderNumber,
      paymentAmount: order.paymentAmount,
      channel: order.channel,
      shippingMethod: order.shippingMethod,
      items: order.items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        optionId: item.optionId,
        option: item.option
          ? {
              id: item.option.id,
              name: item.option.name,
              product: item.option.product,
            }
          : null,
      })),
      createdAt: order.createdAt,
    }
  })

  return NextResponse.json({ data, total, page, pageSize })
}
