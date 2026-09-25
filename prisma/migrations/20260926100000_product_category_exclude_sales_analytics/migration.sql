-- AlterTable
ALTER TABLE "InvProductGroup" ADD COLUMN     "excludeFromSalesAnalytics" BOOLEAN NOT NULL DEFAULT false;


-- 기존 하드코딩 기본값(「배송 부자재」 이름 매칭)을 플래그로 이관 — 동작 불변.
UPDATE "InvProductGroup" SET "excludeFromSalesAnalytics" = true WHERE "name" = '배송 부자재';
