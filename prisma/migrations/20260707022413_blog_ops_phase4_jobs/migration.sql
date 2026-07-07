-- CreateEnum
CREATE TYPE "BoJobKind" AS ENUM ('CRAWL_HOMEPAGE', 'GENERATE_DRAFT', 'GENERATE_VARIANT', 'PUBLISH');

-- CreateEnum
CREATE TYPE "BoJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BoCredentialKind" AS ENUM ('COOKIE', 'OAUTH', 'API_KEY');

-- CreateTable
CREATE TABLE "BoJob" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" "BoJobKind" NOT NULL,
    "status" "BoJobStatus" NOT NULL DEFAULT 'PENDING',
    "targetId" TEXT,
    "payload" JSONB,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoChannelCredential" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "BoCredentialKind" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BoChannelCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoJob_status_scheduledAt_idx" ON "BoJob"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BoJob_spaceId_status_idx" ON "BoJob"("spaceId", "status");

-- CreateIndex
CREATE INDEX "BoJob_kind_status_idx" ON "BoJob"("kind", "status");

-- CreateIndex
CREATE INDEX "BoChannelCredential_channelId_idx" ON "BoChannelCredential"("channelId");

-- CreateIndex
CREATE INDEX "BoChannelCredential_spaceId_idx" ON "BoChannelCredential"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "BoChannelCredential_channelId_kind_key" ON "BoChannelCredential"("channelId", "kind");

-- AddForeignKey
ALTER TABLE "BoJob" ADD CONSTRAINT "BoJob_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoChannelCredential" ADD CONSTRAINT "BoChannelCredential_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoChannelCredential" ADD CONSTRAINT "BoChannelCredential_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "BoChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
