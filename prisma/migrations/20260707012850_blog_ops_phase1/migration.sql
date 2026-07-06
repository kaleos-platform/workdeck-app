-- CreateEnum
CREATE TYPE "BoCrawlStatus" AS ENUM ('NONE', 'PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "BoMaterialStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "BoProduct" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "oneLinerPitch" TEXT,
    "homepageUrl" TEXT,
    "crawledText" TEXT,
    "crawledAt" TIMESTAMP(3),
    "crawlStatus" "BoCrawlStatus" NOT NULL DEFAULT 'NONE',
    "targetCustomer" TEXT,
    "features" JSONB NOT NULL DEFAULT '[]',
    "ctaUrl" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoIdeation" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "productId" TEXT NOT NULL,
    "userPromptInput" TEXT,
    "appealPoints" JSONB NOT NULL DEFAULT '[]',
    "providerName" TEXT,
    "providerModel" TEXT,
    "latencyMs" INTEGER,
    "promptTraceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoIdeation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoMaterial" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ideationId" TEXT,
    "title" TEXT NOT NULL,
    "appealPoint" TEXT NOT NULL,
    "angle" TEXT NOT NULL,
    "outline" JSONB NOT NULL DEFAULT '[]',
    "targetKeyword" TEXT,
    "status" "BoMaterialStatus" NOT NULL DEFAULT 'PROPOSED',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoProduct_spaceId_idx" ON "BoProduct"("spaceId");

-- CreateIndex
CREATE INDEX "BoIdeation_spaceId_createdAt_idx" ON "BoIdeation"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "BoIdeation_productId_idx" ON "BoIdeation"("productId");

-- CreateIndex
CREATE INDEX "BoMaterial_spaceId_status_idx" ON "BoMaterial"("spaceId", "status");

-- CreateIndex
CREATE INDEX "BoMaterial_productId_idx" ON "BoMaterial"("productId");

-- AddForeignKey
ALTER TABLE "BoProduct" ADD CONSTRAINT "BoProduct_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoIdeation" ADD CONSTRAINT "BoIdeation_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoIdeation" ADD CONSTRAINT "BoIdeation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "BoProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoMaterial" ADD CONSTRAINT "BoMaterial_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoMaterial" ADD CONSTRAINT "BoMaterial_productId_fkey" FOREIGN KEY ("productId") REFERENCES "BoProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoMaterial" ADD CONSTRAINT "BoMaterial_ideationId_fkey" FOREIGN KEY ("ideationId") REFERENCES "BoIdeation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
