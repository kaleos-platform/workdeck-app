-- 발주 계획을 상품 단위로 운영하기 위한 productId 추가
-- null = 레거시 전체-계획 (UI에서 "전체"로 표시)

-- AlterTable
ALTER TABLE "ReorderPlan" ADD COLUMN     "productId" TEXT;

-- CreateIndex
CREATE INDEX "ReorderPlan_spaceId_productId_idx" ON "ReorderPlan"("spaceId", "productId");

-- AddForeignKey
ALTER TABLE "ReorderPlan" ADD CONSTRAINT "ReorderPlan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
