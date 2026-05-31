/**
 * 배송 묶음(DelBatch) 삭제 — 묶음 + 주문 + 연동 InvMovement 함께 제거.
 *
 * 연동 InvMovement(이력 이전 OUTBOUND)는 `InvMovement.delBatchId` FK가 onDelete:Cascade라
 * DelBatch 삭제 시 DB가 자동으로 지운다. DelOrder/Item/Fulfillment도 FK cascade.
 * IMPORT 묶음의 OUTBOUND는 재고를 차감하지 않았으므로 역산(reverseMovement)은 불필요하다.
 */

import { prisma } from '@/lib/prisma'

/**
 * 배송 묶음을 삭제한다. 연동 movement·주문은 FK cascade로 함께 삭제된다.
 * 삭제 전에 연동 movement 수를 세어 반환한다(응답 표시용).
 */
export async function deleteBatchWithMovements(
  spaceId: string,
  batchId: string
): Promise<{ deletedMovements: number }> {
  return prisma.$transaction(async (tx) => {
    const deletedMovements = await tx.invMovement.count({
      where: { spaceId, delBatchId: batchId },
    })
    await tx.delBatch.delete({ where: { id: batchId } })
    return { deletedMovements }
  })
}
