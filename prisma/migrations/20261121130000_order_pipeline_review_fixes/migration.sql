-- AlterTable
ALTER TABLE "PipelineOperation" ADD COLUMN     "ingestCalls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ingestRows" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minCalls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "plannedFrom" TIMESTAMP(3),
ADD COLUMN     "plannedThrough" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ChannelOrderScanLine_operationId_externalLineKey_key" ON "ChannelOrderScanLine"("operationId", "externalLineKey");

