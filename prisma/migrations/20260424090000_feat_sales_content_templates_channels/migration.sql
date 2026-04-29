-- ─── Sales Content Deck (템플릿 · 채널) ─────────────────────────────────────

CREATE TYPE "TemplateKind" AS ENUM ('BLOG', 'SOCIAL', 'CARDNEWS');

CREATE TYPE "SalesContentPlatform" AS ENUM (
  'BLOG_NAVER', 'BLOG_TISTORY', 'BLOG_WORDPRESS',
  'THREADS', 'X', 'LINKEDIN', 'FACEBOOK', 'INSTAGRAM', 'YOUTUBE_SHORTS', 'OTHER'
);

CREATE TYPE "SalesContentChannelKind" AS ENUM ('BLOG', 'SOCIAL');

CREATE TYPE "PublisherMode" AS ENUM ('API', 'BROWSER', 'MANUAL');

CREATE TYPE "CollectorMode" AS ENUM ('API', 'BROWSER', 'MANUAL', 'NONE');

-- Template: spaceId nullable (null = 시스템 템플릿)
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "sections" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Template_spaceId_slug_key" ON "Template"("spaceId", "slug");
CREATE INDEX "Template_spaceId_idx" ON "Template"("spaceId");
CREATE INDEX "Template_kind_idx" ON "Template"("kind");

ALTER TABLE "Template"
    ADD CONSTRAINT "Template_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SalesContentChannel: 배포 채널 — seller-hub 의 Channel 과는 구분.
CREATE TABLE "SalesContentChannel" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "platform" "SalesContentPlatform" NOT NULL,
    "kind" "SalesContentChannelKind" NOT NULL,
    "name" TEXT NOT NULL,
    "platformSlug" TEXT NOT NULL,
    "publisherMode" "PublisherMode" NOT NULL DEFAULT 'MANUAL',
    "collectorMode" "CollectorMode" NOT NULL DEFAULT 'MANUAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesContentChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesContentChannel_spaceId_platformSlug_key"
    ON "SalesContentChannel"("spaceId", "platformSlug");
CREATE INDEX "SalesContentChannel_spaceId_idx" ON "SalesContentChannel"("spaceId");
CREATE INDEX "SalesContentChannel_platform_idx" ON "SalesContentChannel"("platform");

ALTER TABLE "SalesContentChannel"
    ADD CONSTRAINT "SalesContentChannel_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
