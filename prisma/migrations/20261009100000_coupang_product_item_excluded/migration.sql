-- 쿠팡 상품 매칭: 매칭 안 함(제외) 표시
ALTER TABLE "CoupangProductItem" ADD COLUMN "excludedAt" TIMESTAMP(3);
