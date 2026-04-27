-- CreateEnum
CREATE TYPE "ProductionRunStatus" AS ENUM ('PLANNED', 'ORDERED', 'PRODUCING', 'COMPLETED');
CREATE TYPE "ProductionCostCategory" AS ENUM ('MATERIAL', 'LABOR', 'PACKAGING', 'LOGISTICS', 'OTHER');

-- AlterTable: ProductionRun (status + brandId + dueAt + completedAt)
ALTER TABLE "ProductionRun" ADD COLUMN "brandId" TEXT;
ALTER TABLE "ProductionRun" ADD COLUMN "dueAt" TIMESTAMP(3);
ALTER TABLE "ProductionRun" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "ProductionRun" ADD COLUMN "status" "ProductionRunStatus" NOT NULL DEFAULT 'PLANNED';

-- AlterTable: ProductionRunCost (category)
ALTER TABLE "ProductionRunCost" ADD COLUMN "category" "ProductionCostCategory" NOT NULL DEFAULT 'OTHER';

-- AddForeignKey
ALTER TABLE "ProductionRun" ADD CONSTRAINT "ProductionRun_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ProductionRun_spaceId_status_idx" ON "ProductionRun"("spaceId", "status");
CREATE INDEX "ProductionRun_brandId_idx" ON "ProductionRun"("brandId");
