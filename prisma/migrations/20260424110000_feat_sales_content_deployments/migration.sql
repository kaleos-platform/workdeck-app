-- ─── Sales Content Deck (배포 · UTM · 클릭) ─────────────────────────────────

CREATE TYPE "DeploymentStatus" AS ENUM (
  'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED'
);

CREATE TABLE "ContentDeployment" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "shortSlug" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "platformUrl" TEXT,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDeployment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentDeployment_shortSlug_key" ON "ContentDeployment"("shortSlug");
CREATE INDEX "ContentDeployment_spaceId_status_idx" ON "ContentDeployment"("spaceId", "status");
CREATE INDEX "ContentDeployment_contentId_idx" ON "ContentDeployment"("contentId");
CREATE INDEX "ContentDeployment_channelId_idx" ON "ContentDeployment"("channelId");

ALTER TABLE "ContentDeployment"
    ADD CONSTRAINT "ContentDeployment_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentDeployment"
    ADD CONSTRAINT "ContentDeployment_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentDeployment"
    ADD CONSTRAINT "ContentDeployment_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "SalesContentChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContentClickEvent" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentClickEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentClickEvent_deploymentId_createdAt_idx"
    ON "ContentClickEvent"("deploymentId", "createdAt");
CREATE INDEX "ContentClickEvent_spaceId_createdAt_idx"
    ON "ContentClickEvent"("spaceId", "createdAt");

ALTER TABLE "ContentClickEvent"
    ADD CONSTRAINT "ContentClickEvent_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentClickEvent"
    ADD CONSTRAINT "ContentClickEvent_deploymentId_fkey"
    FOREIGN KEY ("deploymentId") REFERENCES "ContentDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
