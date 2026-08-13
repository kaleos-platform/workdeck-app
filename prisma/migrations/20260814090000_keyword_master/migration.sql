-- CreateEnum
CREATE TYPE "KeywordMasterStatus" AS ENUM ('PRODUCT_NAME', 'SEARCH_TERM', 'SEARCH_OPTION', 'CANDIDATE', 'EXCLUDED', 'BANNED');

-- CreateEnum
CREATE TYPE "KeywordMasterSource" AS ENUM ('COUPANG_AUTOCOMPLETE', 'COUPANG_RELATED', 'COUPANG_TOP_PRODUCT', 'COUPANG_REVIEW', 'AD_KEYWORD', 'CUSTOMER_INQUIRY', 'INTERNAL');

-- CreateEnum
CREATE TYPE "KeywordMasterType" AS ENUM ('SYNONYM', 'PARENT_CATEGORY', 'MATERIAL', 'SHAPE', 'PURPOSE', 'FEATURE', 'ALIAS', 'COMPETITOR', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "KeywordLinkRole" AS ENUM ('MAIN', 'SUB', 'DENY');

-- CreateTable
CREATE TABLE "KeywordMaster" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "despaced" TEXT NOT NULL,
    "sortedKey" TEXT NOT NULL,
    "category" TEXT,
    "type" "KeywordMasterType" NOT NULL DEFAULT 'UNCLASSIFIED',
    "source" "KeywordMasterSource" NOT NULL DEFAULT 'INTERNAL',
    "status" "KeywordMasterStatus" NOT NULL DEFAULT 'CANDIDATE',
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreInputs" JSONB NOT NULL DEFAULT '{}',
    "researchedAt" TIMESTAMP(3),
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordMasterLink" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "productId" TEXT,
    "listingId" TEXT,
    "role" "KeywordLinkRole" NOT NULL DEFAULT 'SUB',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordMasterLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelKeywordRule" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "maxKeywords" INTEGER,
    "nameTargetMin" INTEGER,
    "nameTargetMax" INTEGER,
    "nameSoftMax" INTEGER,
    "nameHardMax" INTEGER,
    "bannedTerms" JSONB NOT NULL DEFAULT '{}',
    "replaceDefaultTerms" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelKeywordRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordMaster_spaceId_status_idx" ON "KeywordMaster"("spaceId", "status");

-- CreateIndex
CREATE INDEX "KeywordMaster_spaceId_despaced_idx" ON "KeywordMaster"("spaceId", "despaced");

-- CreateIndex
CREATE INDEX "KeywordMaster_spaceId_sortedKey_idx" ON "KeywordMaster"("spaceId", "sortedKey");

-- CreateIndex
CREATE INDEX "KeywordMaster_spaceId_score_idx" ON "KeywordMaster"("spaceId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordMaster_spaceId_normalized_key" ON "KeywordMaster"("spaceId", "normalized");

-- CreateIndex
CREATE INDEX "KeywordMasterLink_productId_idx" ON "KeywordMasterLink"("productId");

-- CreateIndex
CREATE INDEX "KeywordMasterLink_listingId_idx" ON "KeywordMasterLink"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordMasterLink_keywordId_productId_listingId_key" ON "KeywordMasterLink"("keywordId", "productId", "listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelKeywordRule_channelId_key" ON "ChannelKeywordRule"("channelId");

-- CreateIndex
CREATE INDEX "ChannelKeywordRule_spaceId_idx" ON "ChannelKeywordRule"("spaceId");

-- AddForeignKey
ALTER TABLE "KeywordMaster" ADD CONSTRAINT "KeywordMaster_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordMasterLink" ADD CONSTRAINT "KeywordMasterLink_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "KeywordMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordMasterLink" ADD CONSTRAINT "KeywordMasterLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordMasterLink" ADD CONSTRAINT "KeywordMasterLink_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelKeywordRule" ADD CONSTRAINT "ChannelKeywordRule_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelKeywordRule" ADD CONSTRAINT "ChannelKeywordRule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
