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
  // 재고 기능은 seller-hub Deck으로 통합됨. 별도 inventory-mgmt Deck 활성
  // 게이트는 제거(통합 이전 잔재). 호출부(push API)가 이미 seller-hub 컨텍스트를
  // 검증하며, 아래 모든 처리는 spaceId 기반이라 별도 게이트가 불필요하다.

  // 1. Get COMPLETED orders in date range with items and channel info
  const orders = await prisma.delOrder.findMany({
    where: {
      spaceId,
      orderDate: { gte: dateFrom, lte: dateTo },
      batch: { status: 'COMPLETED' },
    },
    include: {
      items: true,
      channel: {
        select: { id: true, name: true, channelTypeDef: { select: { isSalesChannel: true } } },
      },
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

  // 2. For each order, create inventory movements
  for (const order of orders) {
    if (!order.items.length) {
      result.skippedOrders++
      continue
    }

    // Phase 3: channelTypeDef.isSalesChannel 기준으로 이동 유형 결정 (kind 제거)
    const movementType =
      order.channel?.channelTypeDef?.isSalesChannel === false ? 'TRANSFER' : 'OUTBOUND'

    // 공용 Channel을 그대로 사용 (Phase 3: InvSalesChannel 제거)
    const invChannelId: string | undefined = order.channel?.id

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

  // 3. Record integration history
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
