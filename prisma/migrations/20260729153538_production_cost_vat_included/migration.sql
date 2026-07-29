-- 생산 원가 항목별 VAT 포함(공제가능 과세매입) 여부
ALTER TABLE "ProductionRunCost" ADD COLUMN "vatIncluded" BOOLEAN NOT NULL DEFAULT true;
