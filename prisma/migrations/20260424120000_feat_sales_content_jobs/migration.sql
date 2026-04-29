-- ─── Sales Content Deck (자격증명 · 작업 큐) ────────────────────────────────

CREATE TYPE "ChannelCredentialKind" AS ENUM ('COOKIE', 'OAUTH', 'API_KEY');
CREATE TYPE "SalesContentJobKind" AS ENUM ('PUBLISH', 'COLLECT_METRIC', 'INSIGHT_SWEEP');
CREATE TYPE "SalesContentJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED');

CREATE TABLE "ChannelCredential" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "ChannelCredentialKind" NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelCredential_channelId_kind_key"
    ON "ChannelCredential"("channelId", "kind");
CREATE INDEX "ChannelCredential_spaceId_idx" ON "ChannelCredential"("spaceId");

ALTER TABLE "ChannelCredential"
    ADD CONSTRAINT "ChannelCredential_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelCredential"
    ADD CONSTRAINT "ChannelCredential_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "SalesContentChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesContentJob" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "kind" "SalesContentJobKind" NOT NULL,
    "status" "SalesContentJobStatus" NOT NULL DEFAULT 'PENDING',
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

    CONSTRAINT "SalesContentJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesContentJob_status_scheduledAt_idx"
    ON "SalesContentJob"("status", "scheduledAt");
CREATE INDEX "SalesContentJob_spaceId_status_idx"
    ON "SalesContentJob"("spaceId", "status");
CREATE INDEX "SalesContentJob_kind_status_idx"
    ON "SalesContentJob"("kind", "status");

ALTER TABLE "SalesContentJob"
    ADD CONSTRAINT "SalesContentJob_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
