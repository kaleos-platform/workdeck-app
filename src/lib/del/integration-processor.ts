import { prisma } from '@/lib/prisma'
import { processMovement, type MovementInput } from '@/lib/inv/movement-processor'

export type IntegrationResult = {
  totalOrders: number
  createdMovements: number
  skippedOrders: number
  errors: { orderId: string; message: string }[]
}

export async function pushToInventoryDeck(
  spaceId: string,
  dateFrom: Date,
  dateTo: Date,
  locationId: string
): Promise<IntegrationResult> {
  // 1. Verify inventory deck is active
  const invDeck = await prisma.deckInstance.findUnique({
    where: { spaceId_deckAppId: { spaceId, deckAppId: 'inventory-mgmt' } },
  })
  if (!invDeck?.isActive) throw new Error('통합 재고 관리 덱이 활성화되지 않았습니다')

  // 2. Get COMPLETED orders in date range with items and channel info
  const orders = await prisma.delOrder.findMany({
    where: {
      spaceId,
      orderDate: { gte: dateFrom, lte: dateTo },
      batch: { status: 'COMPLETED' },
    },
    include: {
      items: true,
      channel: { select: { id: true, name: true, type: true } },
      shippingMethod: { select: { name: true } },
      batch: { select: { completedAt: true, status: true } },
    },
  })

  const result: IntegrationResult = {
    totalOrders: orders.length,
    createdMovements: 0,
    skippedOrders: 0,
    errors: [],
  }

  // 3. For each order, create inventory movements
  for (const order of orders) {
    if (!order.items.length) {
      result.skippedOrders++
      continue
    }

    // Determine movement type from channel type
    const movementType = order.channel?.type === 'TRANSFER' ? 'TRANSFER' : 'OUTBOUND'

    // Find matching InvSalesChannel by name
    let invChannelId: string | undefined
    if (order.channel) {
      const invChannel = await prisma.invSalesChannel.findFirst({
        where: { spaceId, name: order.channel.name },
        select: { id: true },
      })
      invChannelId = invChannel?.id
    }

    for (const item of order.items) {
      // Find matching product option by name
      const option = await prisma.invProductOption.findFirst({
        where: {
          product: { spaceId },
          name: { contains: item.name, mode: 'insensitive' },
        },
        select: { id: true },
      })

      const input: MovementInput = {
        type: movementType,
        optionId: option?.id,
        productName: option ? undefined : item.name,
        optionName: option ? undefined : item.name,
        locationId,
        quantity: item.quantity,
        movementDate:
          order.batch.completedAt?.toISOString().split('T')[0] ??
          new Date().toISOString().split('T')[0],
        orderDate: order.orderDate.toISOString().split('T')[0],
        channelId: invChannelId,
        reason: `배송관리 연동 (${order.shippingMethod?.name ?? '미지정'})`,
      }

      try {
        await processMovement(spaceId, input)
        result.createdMovements++
      } catch (err) {
        result.errors.push({
          orderId: order.id,
          message: err instanceof Error ? err.message : '이동 생성 실패',
        })
      }
    }
  }

  // 4. Record integration history
  await prisma.delIntegrationHistory.create({
    data: {
      spaceId,
      type: 'INVENTORY',
      dateFrom,
      dateTo,
      totalOrders: result.totalOrders,
      movementIds: [],
    },
  })

  return result
}
