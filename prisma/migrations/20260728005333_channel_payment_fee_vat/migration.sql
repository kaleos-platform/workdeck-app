-- 결제 수수료 VAT 독립 플래그 추가 + 판매 수수료 VAT 기본값 미포함 전환
ALTER TABLE "Channel" ADD COLUMN "paymentFeeVatIncluded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Channel" ALTER COLUMN "vatIncludedInFee" SET DEFAULT false;
