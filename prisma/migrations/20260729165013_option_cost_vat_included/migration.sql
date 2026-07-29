-- 옵션 공급원가 입력값 VAT 포함 여부(ex-VAT 파생용)
ALTER TABLE "InvProductOption" ADD COLUMN "costVatIncluded" BOOLEAN NOT NULL DEFAULT false;
