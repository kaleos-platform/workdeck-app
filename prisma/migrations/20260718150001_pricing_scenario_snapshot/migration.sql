-- PricingScenario: 상품 단위 조회용 productIds + 라이브 시뮬 스냅샷 복원용 inputSnapshot 추가
ALTER TABLE "PricingScenario" ADD COLUMN "productIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "PricingScenario" ADD COLUMN "inputSnapshot" JSONB;
