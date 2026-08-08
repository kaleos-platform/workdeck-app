-- CreateEnum
CREATE TYPE "ScResourceKind" AS ENUM ('URL', 'FILE');

-- CreateEnum
CREATE TYPE "ScResourceStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "BrandProfile" ADD COLUMN     "logoUrl" TEXT;

-- CreateTable
CREATE TABLE "SalesContentOnboarding" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "draft" JSONB,
    "draftStatus" TEXT,
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesContentOnboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScOnboardingResource" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" "ScResourceKind" NOT NULL,
    "sourceUrl" TEXT,
    "storagePath" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "extractedText" TEXT,
    "status" "ScResourceStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScOnboardingResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesContentOnboarding_spaceId_key" ON "SalesContentOnboarding"("spaceId");

-- CreateIndex
CREATE INDEX "ScOnboardingResource_spaceId_idx" ON "ScOnboardingResource"("spaceId");

-- AddForeignKey
ALTER TABLE "SalesContentOnboarding" ADD CONSTRAINT "SalesContentOnboarding_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScOnboardingResource" ADD CONSTRAINT "ScOnboardingResource_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
