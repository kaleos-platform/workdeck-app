import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => ({}))
  const type = body?.type as 'SALES' | 'INVENTORY' | undefined
  const dateFrom = body?.dateFrom ? new Date(body.dateFrom) : null
  const dateTo = body?.dateTo ? new Date(body.dateTo) : null
  const format = (body?.format ?? 'EXCEL') as 'EXCEL' | 'CSV'

  if (!type || !dateFrom || !dateTo) {
    return errorResponse('type, dateFrom, dateTo가 필요합니다', 400)
  }

  const orders = await prisma.delOrder.findMany({
    where: {
      spaceId: resolved.space.id,
      orderDate: { gte: dateFrom, lte: dateTo },
      batch: { status: 'COMPLETED' },
    },
    include: {
      items: true,
      channel: { select: { name: true } },
      shippingMethod: { select: { name: true } },
      batch: { select: { completedAt: true } },
    },
    orderBy: { orderDate: 'asc' },
  })

  const wb = XLSX.utils.book_new()

  if (type === 'SALES') {
    const rows = orders.flatMap((order) =>
      order.items.map((item) => ({
        주문일자: order.orderDate.toISOString().split('T')[0],
        채널: order.channel?.name ?? '',
        상품명: item.name,
        수량: item.quantity,
        결제금액: order.paymentAmount != null ? Number(order.paymentAmount) : '',
        주문번호: order.orderNumber ?? '',
      }))
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, '매출')
  } else {
    const rows = orders.flatMap((order) =>
      order.items.map((item) => ({
        출고일자: order.batch.completedAt?.toISOString().split('T')[0] ?? '',
        채널: order.channel?.name ?? '',
        상품명: item.name,
        수량: item.quantity,
        구분: '출고',
        주문일자: order.orderDate.toISOString().split('T')[0],
        배송방식: order.shippingMethod?.name ?? '',
      }))
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, '재고')
  }

  const bookType = format === 'CSV' ? 'csv' : 'xlsx'
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType }))
  const ext = format === 'CSV' ? 'csv' : 'xlsx'
  const contentType =
    format === 'CSV'
      ? 'text/csv'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  const filename = encodeURIComponent(`${type === 'SALES' ? '매출' : '재고'}_데이터.${ext}`)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
