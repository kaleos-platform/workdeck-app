/**
 * 배송 묶음 완료 시 위치 재고 차감 — 출고 위치(locationId)가 설정된 배송 방식의 주문만.
 * 예: "3PL" 배송 방식 → 3PL 창고 위치 OUTBOUND. 멱등: delBatchId 기존 movement 있으면 skip.
 * 호출 측 트랜잭션 내에서 사용한다 (배치 완료 tx).
 */

import { applyBatchOutbound, type BatchOutboundItem } from '@/lib/inv/movement-processor'
import { prisma } from '@/lib/prisma'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]

export async function applyBatchOutboundForBatch(
  tx: Tx,
  spaceId: string,
  batchId: string,
  movementDate: Date
): Promise<void> {
  const alreadyMoved = await tx.invMovement.count({ where: { delBatchId: batchId } })
  if (alreadyMoved > 0) return

  const outboundLines = await tx.delOrderItem.findMany({
    where: {
      order: { batchId, shippingMethod: { locationId: { not: null } } },
    },
    select: {
      quantity: true,
      optionId: true,
      fulfillments: { select: { optionId: true, quantity: true } },
      order: {
        select: {
          channelId: true,
          shippingMethod: { select: { locationId: true } },
        },
      },
    },
  })

  // 옵션×위치×채널 단위 합산 (fulfillments 있으면 팬아웃, 없으면 단일 옵션 직접 — option-demand와 동일 규칙)
  const agg = new Map<string, BatchOutboundItem>()
  const addOut = (
    optionId: string,
    locationId: string,
    channelId: string | null,
    quantity: number
  ) => {
    const key = `${optionId}|${locationId}|${channelId ?? ''}`
    const cur = agg.get(key)
    if (cur) cur.quantity += quantity
    else agg.set(key, { optionId, locationId, channelId, quantity })
  }
  for (const line of outboundLines) {
    const locationId = line.order.shippingMethod!.locationId!
    const channelId = line.order.channelId
    if (line.fulfillments.length > 0) {
      for (const f of line.fulfillments) addOut(f.optionId, locationId, channelId, f.quantity)
    } else if (line.optionId) {
      addOut(line.optionId, locationId, channelId, line.quantity)
    }
    // 미매칭(option·fulfillment 둘 다 없음)은 옵션 귀속 불가 → 차감 제외
  }

  await applyBatchOutbound(tx, spaceId, [...agg.values()], movementDate, batchId)
}
