-- 가격 시뮬레이터 공통 VAT 설정 (시나리오별 VAT 대체)
ALTER TABLE "ProductPricingSettings"
  ADD COLUMN "defaultIncludeVat" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "defaultVatRate" DECIMAL(6,4) NOT NULL DEFAULT 0.1;
