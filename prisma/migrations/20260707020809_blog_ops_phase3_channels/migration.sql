-- CreateEnum
CREATE TYPE "BoPlatform" AS ENUM ('NAVER_BLOG', 'TISTORY', 'OWN_HOMEPAGE');

-- CreateEnum
CREATE TYPE "BoPublisherMode" AS ENUM ('MANUAL', 'BROWSER');

-- CreateEnum
CREATE TYPE "BoVariantStatus" AS ENUM ('GENERATING', 'READY', 'EDITED', 'FAILED');

-- CreateEnum
CREATE TYPE "BoDeploymentStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED', 'EXPORTED');

-- CreateTable
CREATE TABLE "BoChannel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "platform" "BoPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "formatProfile" JSONB NOT NULL DEFAULT '{}',
    "publisherMode" "BoPublisherMode" NOT NULL DEFAULT 'MANUAL',
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoPostVariant" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "exportedMarkdown" TEXT,
    "exportedHtml" TEXT,
    "status" "BoVariantStatus" NOT NULL DEFAULT 'GENERATING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoPostVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoDeployment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" "BoDeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "platformUrl" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoChannel_spaceId_idx" ON "BoChannel"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BoChannel_spaceId_platform_name_key" ON "BoChannel"("spaceId", "platform", "name");

-- CreateIndex
CREATE INDEX "BoPostVariant_spaceId_idx" ON "BoPostVariant"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BoPostVariant_postId_channelId_key" ON "BoPostVariant"("postId", "channelId");

-- CreateIndex
CREATE INDEX "BoDeployment_spaceId_status_idx" ON "BoDeployment"("spaceId", "status");

-- CreateIndex
CREATE INDEX "BoDeployment_postId_idx" ON "BoDeployment"("postId");

-- AddForeignKey
ALTER TABLE "BoChannel" ADD CONSTRAINT "BoChannel_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoPostVariant" ADD CONSTRAINT "BoPostVariant_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoPostVariant" ADD CONSTRAINT "BoPostVariant_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BoPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoPostVariant" ADD CONSTRAINT "BoPostVariant_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "BoChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoDeployment" ADD CONSTRAINT "BoDeployment_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoDeployment" ADD CONSTRAINT "BoDeployment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BoPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoDeployment" ADD CONSTRAINT "BoDeployment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "BoPostVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoDeployment" ADD CONSTRAINT "BoDeployment_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "BoChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
