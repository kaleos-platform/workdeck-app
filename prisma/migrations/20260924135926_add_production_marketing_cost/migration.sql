-- migrate dev shadow DB P3006 때문에 격리 baseline에서 Prisma로 생성한 후 dev DB에 migrate deploy로 적용한다.

-- AlterEnum
ALTER TYPE "ProductionCostCategory" ADD VALUE 'MARKETING';

-- AlterTable
ALTER TABLE "ProductionRunCost" ADD COLUMN     "targetProductId" TEXT;

-- CreateIndex
CREATE INDEX "ProductionRunCost_targetProductId_idx" ON "ProductionRunCost"("targetProductId");

-- AddForeignKey
ALTER TABLE "ProductionRunCost" ADD CONSTRAINT "ProductionRunCost_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "InvProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
