-- AlterTable: 배송 이력 이전으로 생성된 OUTBOUND의 출처 묶음 FK
ALTER TABLE "InvMovement" ADD COLUMN "delBatchId" TEXT;

-- CreateIndex
CREATE INDEX "InvMovement_delBatchId_idx" ON "InvMovement"("delBatchId");

-- AddForeignKey
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_delBatchId_fkey" FOREIGN KEY ("delBatchId") REFERENCES "DelBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
