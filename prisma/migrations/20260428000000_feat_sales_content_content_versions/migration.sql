-- ─── Sales Content Deck (콘텐츠 버전 히스토리) ───────────────────────────────

CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "doc" JSONB NOT NULL,
    "snapshotHash" TEXT,
    "createdByUserId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- contentId + versionNumber 복합 유니크 (content 내 단조 증가 버전 번호 보장)
CREATE UNIQUE INDEX "ContentVersion_contentId_versionNumber_key"
    ON "ContentVersion"("contentId", "versionNumber");

-- 콘텐츠별 버전 시간순 조회
CREATE INDEX "ContentVersion_contentId_createdAt_idx"
    ON "ContentVersion"("contentId", "createdAt");

-- 공간별 전체 버전 시간순 조회
CREATE INDEX "ContentVersion_spaceId_createdAt_idx"
    ON "ContentVersion"("spaceId", "createdAt");

-- FK: Content (CASCADE DELETE — 콘텐츠 삭제 시 버전도 함께 삭제)
ALTER TABLE "ContentVersion"
    ADD CONSTRAINT "ContentVersion_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: Space (CASCADE DELETE)
ALTER TABLE "ContentVersion"
    ADD CONSTRAINT "ContentVersion_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
