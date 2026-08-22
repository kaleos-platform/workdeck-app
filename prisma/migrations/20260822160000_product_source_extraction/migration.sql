
-- CreateEnum
CREATE TYPE "ProductExtractionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductExtractionSourceKind" AS ENUM ('URL', 'TEXT', 'IMAGE', 'PDF');

-- AlterTable
ALTER TABLE "WorkspaceAiCredit" ADD COLUMN     "textQuota" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "textUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TextGenerationLog" ADD COLUMN     "creditMonth" TEXT;

-- CreateTable
CREATE TABLE "ProductExtractionJob" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "ProductExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "result" JSONB,
    "rawResponse" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "textLogId" TEXT,
    "creditMonth" TEXT,
    "appliedAt" TIMESTAMP(3),
    "appliedFields" JSONB,
    "appliedBefore" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductExtractionSource" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" "ProductExtractionSourceKind" NOT NULL,
    "url" TEXT,
    "finalUrl" TEXT,
    "storagePath" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "textContent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductExtractionSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductExtractionJob_productId_createdAt_idx" ON "ProductExtractionJob"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductExtractionJob_spaceId_createdAt_idx" ON "ProductExtractionJob"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductExtractionJob_status_idx" ON "ProductExtractionJob"("status");

-- CreateIndex
CREATE INDEX "ProductExtractionSource_jobId_idx" ON "ProductExtractionSource"("jobId");

-- CreateIndex
CREATE INDEX "ProductExtractionSource_spaceId_createdAt_idx" ON "ProductExtractionSource"("spaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductExtractionJob" ADD CONSTRAINT "ProductExtractionJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExtractionJob" ADD CONSTRAINT "ProductExtractionJob_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductExtractionSource" ADD CONSTRAINT "ProductExtractionSource_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProductExtractionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

