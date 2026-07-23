-- 적정 원가율 상한 (KPI 원가율 경고 임계). 기존 행은 기본값 0.33으로 백필.
ALTER TABLE "ProductPricingSettings" ADD COLUMN "maxCostRatio" DECIMAL(5,4) NOT NULL DEFAULT 0.33;
