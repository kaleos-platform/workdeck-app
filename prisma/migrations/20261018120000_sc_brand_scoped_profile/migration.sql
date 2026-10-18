-- 세일즈 콘텐츠 브랜드 단위 데이터: BrandProfile 을 Space당 1개에서 브랜드별로, Product 에 브랜드 연결.
-- 기존 BrandProfile 행은 brandId = NULL(공통 프로필)로 남는다.

-- DropIndex
DROP INDEX "BrandProfile_spaceId_key";

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brandId" TEXT;

-- CreateIndex
CREATE INDEX "BrandProfile_spaceId_idx" ON "BrandProfile"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandProfile_spaceId_brandId_key" ON "BrandProfile"("spaceId", "brandId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandProfile" ADD CONSTRAINT "BrandProfile_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
