-- CreateEnum
CREATE TYPE "InvStorageLocationType" AS ENUM ('OWN', 'THIRD_PARTY', 'STORE');

-- AlterTable: 보관 장소 타입 추가
ALTER TABLE "InvStorageLocation"
  ADD COLUMN "type" "InvStorageLocationType" NOT NULL DEFAULT 'OWN';

-- CreateIndex
CREATE INDEX "InvStorageLocation_spaceId_type_idx" ON "InvStorageLocation"("spaceId", "type");

-- AlterTable: 옵션 단위 안전재고 추가
ALTER TABLE "InvProductOption"
  ADD COLUMN "safetyStockQty" INTEGER NOT NULL DEFAULT 0;

-- 데이터 백필: 기존 InvReorderConfig.safetyStockQty 값을 해당 상품의 모든 옵션으로 복사
UPDATE "InvProductOption" o
SET "safetyStockQty" = c."safetyStockQty"
FROM "InvReorderConfig" c
WHERE o."productId" = c."productId"
  AND c."safetyStockQty" > 0;

-- AlterTable: InvReorderConfig에서 safetyStockQty 제거 (단일 진입점)
ALTER TABLE "InvReorderConfig"
  DROP COLUMN "safetyStockQty";
