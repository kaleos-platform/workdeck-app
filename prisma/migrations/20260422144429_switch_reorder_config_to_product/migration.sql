-- InvReorderConfig: optionId 단위 → productId 단위로 교체
-- 테스트 데이터만 존재하므로 기존 레코드 삭제

-- 1) 기존 FK 제거 + 데이터 삭제
DELETE FROM "InvReorderConfig";

ALTER TABLE "InvReorderConfig"
  DROP CONSTRAINT IF EXISTS "InvReorderConfig_optionId_fkey";

DROP INDEX IF EXISTS "InvReorderConfig_optionId_key";
DROP INDEX IF EXISTS "InvReorderConfig_optionId_idx";

-- 2) 컬럼 교체
ALTER TABLE "InvReorderConfig" DROP COLUMN "optionId";
ALTER TABLE "InvReorderConfig" ADD COLUMN "productId" TEXT NOT NULL;

-- 3) 새 UNIQUE + INDEX + FK
CREATE UNIQUE INDEX "InvReorderConfig_productId_key" ON "InvReorderConfig"("productId");
CREATE INDEX "InvReorderConfig_productId_idx" ON "InvReorderConfig"("productId");

ALTER TABLE "InvReorderConfig"
  ADD CONSTRAINT "InvReorderConfig_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
