import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { generateDeliveryFile } from '@/lib/del/delivery-file-generator'
import type { DelFormatColumn } from '@/lib/del/format-templates'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const batchId = typeof body?.batchId === 'string' ? body.batchId : ''
  const shippingMethodId = typeof body?.shippingMethodId === 'string' ? body.shippingMethodId : ''

  if (!batchId || !shippingMethodId) {
    return errorResponse('batchId와 shippingMethodId가 필요합니다', 400)
  }

  // 배송 묶음 확인
  const batch = await prisma.delBatch.findUnique({
    where: { id: batchId },
    select: { spaceId: true },
  })
  if (!batch || batch.spaceId !== resolved.space.id) {
    return errorResponse('배송 묶음을 찾을 수 없습니다', 404)
  }

  // 배송 방식 확인
  const method = await prisma.delShippingMethod.findUnique({
    where: { id: shippingMethodId },
    select: { spaceId: true, name: true, formatConfig: true },
  })
  if (!method || method.spaceId !== resolved.space.id) {
    return errorResponse('배송 방식을 찾을 수 없습니다', 404)
  }

  // 해당 배송 묶음 + 배송방식의 주문 조회
  const orders = await prisma.delOrder.findMany({
    where: {
      batchId,
      shippingMethodId,
      spaceId: resolved.space.id,
    },
    include: {
      items: true,
      channel: { select: { name: true } },
    },
  })

  if (orders.length === 0) {
    return errorResponse('해당 배송 방식의 주문이 없습니다', 400)
  }

  const formatConfig = method.formatConfig as DelFormatColumn[]
  const buffer = generateDeliveryFile(orders, formatConfig)

  const filename = encodeURIComponent(`${method.name}_배송파일.xlsx`)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
