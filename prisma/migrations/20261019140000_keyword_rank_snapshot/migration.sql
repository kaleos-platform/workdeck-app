-- CreateEnum
CREATE TYPE "RankSource" AS ENUM ('COUPANG', 'NAVER_SHOPPING');

-- CreateEnum
CREATE TYPE "RankStatus" AS ENUM ('RANKED', 'NOT_IN_TOP100', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "ProductListing" ADD COLUMN     "rankTracking" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ChannelProduct" ADD COLUMN     "rankTracking" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "KeywordRankSnapshot" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "channelProductId" TEXT,
    "listingId" TEXT,
    "source" "RankSource" NOT NULL,
    "keyword" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "RankStatus" NOT NULL,
    "rank" INTEGER,
    "adShown" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordRankSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordRankSnapshot_spaceId_date_idx" ON "KeywordRankSnapshot"("spaceId", "date");

-- CreateIndex
CREATE INDEX "KeywordRankSnapshot_channelProductId_date_idx" ON "KeywordRankSnapshot"("channelProductId", "date");

-- CreateIndex
CREATE INDEX "KeywordRankSnapshot_listingId_date_idx" ON "KeywordRankSnapshot"("listingId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordRankSnapshot_targetKey_source_keyword_date_key" ON "KeywordRankSnapshot"("targetKey", "source", "keyword", "date");

-- AddForeignKey
ALTER TABLE "KeywordRankSnapshot" ADD CONSTRAINT "KeywordRankSnapshot_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRankSnapshot" ADD CONSTRAINT "KeywordRankSnapshot_channelProductId_fkey" FOREIGN KEY ("channelProductId") REFERENCES "ChannelProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRankSnapshot" ADD CONSTRAINT "KeywordRankSnapshot_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 신규 테이블은 RLS 를 켠다(앱은 서비스 롤로 접근 — Supabase 공개 API 노출 차단).
ALTER TABLE "KeywordRankSnapshot" ENABLE ROW LEVEL SECURITY;
