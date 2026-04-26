-- DropTable + DropIndex (legacy ProductionBatch)
DROP TABLE IF EXISTS "ProductionBatch";

-- CreateEnum
CREATE TYPE "ProductionCostMode" AS ENUM ('TOTAL', 'BREAKDOWN');

-- CreateTable: ProductionRun
CREATE TABLE "ProductionRun" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "totalCost" DECIMAL(18,2),
    "costMode" "ProductionCostMode" NOT NULL DEFAULT 'TOTAL',
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProductionRunItem
CREATE TABLE "ProductionRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProductionRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProductionRunCost
CREATE TABLE "ProductionRunCost" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "description" TEXT,
    "spec" DECIMAL(18,4),
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductionRunCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRun_spaceId_runNo_key" ON "ProductionRun"("spaceId", "runNo");
CREATE INDEX "ProductionRun_spaceId_orderedAt_idx" ON "ProductionRun"("spaceId", "orderedAt");
CREATE UNIQUE INDEX "ProductionRunItem_runId_optionId_key" ON "ProductionRunItem"("runId", "optionId");
CREATE INDEX "ProductionRunItem_optionId_idx" ON "ProductionRunItem"("optionId");
CREATE INDEX "ProductionRunCost_runId_idx" ON "ProductionRunCost"("runId");

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRunItem" ADD CONSTRAINT "ProductionRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionRunItem" ADD CONSTRAINT "ProductionRunItem_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionRunCost" ADD CONSTRAINT "ProductionRunCost_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProductionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
