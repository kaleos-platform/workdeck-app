-- CreateEnum
CREATE TYPE "BoPostStatus" AS ENUM ('GENERATING', 'DRAFT', 'IN_REVIEW', 'PUBLISH_APPROVED', 'PUBLISHED', 'FAILED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "BoPost" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "materialId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "bodyMarkdown" TEXT,
    "status" "BoPostStatus" NOT NULL DEFAULT 'GENERATING',
    "targetKeyword" TEXT,
    "relatedKeywords" JSONB NOT NULL DEFAULT '[]',
    "ctaUrl" TEXT,
    "publishApprovedByUserId" TEXT,
    "publishApprovedAt" TIMESTAMP(3),
    "generationTraceHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoPostVersion" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoPostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoPost_spaceId_status_idx" ON "BoPost"("spaceId", "status");

-- CreateIndex
CREATE INDEX "BoPost_materialId_idx" ON "BoPost"("materialId");

-- CreateIndex
CREATE INDEX "BoPostVersion_spaceId_createdAt_idx" ON "BoPostVersion"("spaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BoPostVersion_postId_versionNumber_key" ON "BoPostVersion"("postId", "versionNumber");

-- AddForeignKey
ALTER TABLE "BoPost" ADD CONSTRAINT "BoPost_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoPost" ADD CONSTRAINT "BoPost_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "BoMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoPostVersion" ADD CONSTRAINT "BoPostVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BoPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoPostVersion" ADD CONSTRAINT "BoPostVersion_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
