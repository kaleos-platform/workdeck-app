/**
 * 배송 묶음(DelBatch) 삭제 — 묶음 + 주문 + 연동 InvMovement 함께 제거.
 *
 * 연동 InvMovement는 `InvMovement.delBatchId` FK가 onDelete:Cascade라
 * DelBatch 삭제 시 DB가 자동으로 지운다. DelOrder/Item/Fulfillment도 FK cascade.
 * IMPORT 묶음의 OUTBOUND(이력 이전)는 재고를 차감하지 않았으므로 역산이 불필요하지만,
 * MANUAL 묶음 완료 시 생성된 OUTBOUND(배송 방식 출고 위치 차감)는 cascade 전에
 * reverseMovement로 위치 재고를 복원해야 한다.
 *
 * MANUAL 묶음의 channelStock 복원:
 *   COMPLETED 상태에서 차감된 channelStock은 ChannelStockMovement 원장에 정확히 기록된다.
 *   DelBatch 삭제 시 FK cascade로 원장 행은 사라지지만 카운터는 감소한 채 남아 재고가 영구 누락된다.
 *   삭제 전에 원장을 읽어 listing별 합산분을 정확히 복원(increment)한다.
 *   null channelStock에 increment를 적용하면 null 유지로 복원이 무시되므로 non-null listing만 대상.
 */

import { prisma } from '@/lib/prisma'
import { lockStockLevel, reverseMovement } from '@/lib/inv/movement-processor'

/**
 * 배송 묶음을 삭제한다. 연동 movement·주문은 FK cascade로 함께 삭제된다.
 * MANUAL 묶음이면 차감된 channelStock을 복원한다.
 * 삭제 전에 연동 movement 수를 세어 반환한다(응답 표시용).
 */
export async function deleteBatchWithMovements(
  spaceId: string,
  batchId: string
): Promise<{ deletedMovements: number }> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.delBatch.findUnique({
      where: { id: batchId },
      select: { source: true },
    })

    const invMovements = await tx.invMovement.findMany({
      where: { spaceId, delBatchId: batchId },
    })
    const deletedMovements = invMovements.length

    // MANUAL 묶음 완료 시 차감된 위치 재고 복원 — cascade가 movement를 지우기 전에 역산.
    // IMPORT(이력 이전) movement는 재고 미차감이었으므로 제외.
    if (batch?.source === 'MANUAL' && invMovements.length > 0) {
      const sorted = [...invMovements].sort((a, b) =>
        a.optionId === b.optionId
          ? a.locationId.localeCompare(b.locationId)
          : a.optionId.localeCompare(b.optionId)
      )
      const locked = new Set<string>()
      for (const m of sorted) {
        const key = `${m.optionId}|${m.locationId}`
        if (!locked.has(key)) {
          await lockStockLevel(tx, m.optionId, m.locationId)
          locked.add(key)
        }
        await reverseMovement(tx, spaceId, m)
      }
    }

    // MANUAL 묶음의 channelStock 복원 — 삭제 cascade가 ChannelStockMovement를 지우기 전에 읽어야 함
    const stockMovements = await tx.channelStockMovement.findMany({
      where: { batchId },
      select: { listingId: true, quantity: true },
    })

    if (stockMovements.length > 0) {
      // listingId별 복원량 합산
      const restoreByListing = new Map<string, number>()
      for (const m of stockMovements) {
        restoreByListing.set(m.listingId, (restoreByListing.get(m.listingId) ?? 0) + m.quantity)
      }

      // channelStock이 non-null인 listing만 복원 대상
      // (null = 기능 off — increment 시 null 유지로 복원이 조용히 무시되므로 명시적으로 필터)
      const listingIds = [...restoreByListing.keys()]
      const eligibleRows = await tx.productListing.findMany({
        where: { id: { in: listingIds }, channelStock: { not: null } },
        select: { id: true },
      })
      const eligible = new Set(eligibleRows.map((l) => l.id))

      for (const [lid, sum] of restoreByListing) {
        if (!eligible.has(lid)) continue
        // channelStock은 ChannelStockMovement 원장을 가진 가역 카운터 — 음수 floor를 넣지 않음.
        // 음수(오버셀)는 표시 계층 listing-calc가 <=0을 품절 처리하므로 그대로 반영.
        await tx.productListing.update({
          where: { id: lid },
          data: { channelStock: { increment: sum } },
        })
      }
    }

    await tx.delBatch.delete({ where: { id: batchId } })
    return { deletedMovements }
  })
}
