-- 레이어드 발주(연동 세트 + 직접 배송) — 직접 배송 레이어 GROSS 보관 컬럼.
-- 세트 수량 PATCH 시 단일차감(safety−stock 1회) 재적용에 필요. null = 비레이어드 플랜.
-- AlterTable
ALTER TABLE "ReorderPlanItem" ADD COLUMN "directGrossQty" DECIMAL(18,4);
