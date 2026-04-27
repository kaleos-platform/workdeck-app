-- ─── Sales Content Deck (콘텐츠 제작) ────────────────────────────────────────

CREATE TYPE "ContentStatus" AS ENUM (
  'DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ANALYZED'
);

CREATE TYPE "ContentAssetKind" AS ENUM ('IMAGE', 'LINK');

CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "ideationId" TEXT,
    "ideaIndex" INTEGER,
    "productId" TEXT,
    "personaId" TEXT,
    "channelId" TEXT,
    "doc" JSONB NOT NULL,
    "snapshotHash" TEXT,
    "publishedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Content_spaceId_status_idx" ON "Content"("spaceId", "status");
CREATE INDEX "Content_spaceId_createdAt_idx" ON "Content"("spaceId", "createdAt");
CREATE INDEX "Content_channelId_idx" ON "Content"("channelId");

ALTER TABLE "Content"
    ADD CONSTRAINT "Content_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Content"
    ADD CONSTRAINT "Content_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "SalesContentChannel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ContentAsset" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "kind" "ContentAssetKind" NOT NULL,
    "slotKey" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "alt" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentAsset_contentId_idx" ON "ContentAsset"("contentId");
CREATE INDEX "ContentAsset_spaceId_idx" ON "ContentAsset"("spaceId");

ALTER TABLE "ContentAsset"
    ADD CONSTRAINT "ContentAsset_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentAsset"
    ADD CONSTRAINT "ContentAsset_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
