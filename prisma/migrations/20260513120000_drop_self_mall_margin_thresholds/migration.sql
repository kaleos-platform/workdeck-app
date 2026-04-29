-- 자사몰/플랫폼몰 마진 분기 통일 후속: ProductPricingSettings에서 자사몰 임계값 컬럼 제거
-- platformTargetGood/Fair 만 사용. 사용자는 설정 페이지에서 자유롭게 조정 가능.

ALTER TABLE "ProductPricingSettings" DROP COLUMN IF EXISTS "selfMallTargetGood";
ALTER TABLE "ProductPricingSettings" DROP COLUMN IF EXISTS "selfMallTargetFair";
