-- CreateEnum
CREATE TYPE "KeywordChangeReason" AS ENUM ('WRONG_MAIN_KEYWORD', 'UNCLEAR_NAME', 'POLICY_RISK', 'NEW_SEARCH_DATA', 'SPEC_CHANGE', 'BRAND_MODEL_CHANGE', 'INITIAL_REGISTRATION', 'TYPO_FIX', 'OTHER');

-- CreateTable
CREATE TABLE "KeywordChangeLog" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "listingId" TEXT,
    "productId" TEXT,
    "beforeName" TEXT,
    "afterName" TEXT,
    "beforeKeywords" JSONB NOT NULL DEFAULT '[]',
    "afterKeywords" JSONB NOT NULL DEFAULT '[]',
    "reason" "KeywordChangeReason" NOT NULL,
    "reasonNote" TEXT,
    "observeMetric" TEXT,
    "multiChange" BOOLEAN NOT NULL DEFAULT false,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeywordChangeLog_spaceId_createdAt_idx" ON "KeywordChangeLog"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "KeywordChangeLog_listingId_createdAt_idx" ON "KeywordChangeLog"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "KeywordChangeLog_productId_createdAt_idx" ON "KeywordChangeLog"("productId", "createdAt");

-- AddForeignKey
ALTER TABLE "KeywordChangeLog" ADD CONSTRAINT "KeywordChangeLog_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordChangeLog" ADD CONSTRAINT "KeywordChangeLog_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordChangeLog" ADD CONSTRAINT "KeywordChangeLog_productId_fkey" FOREIGN KEY ("productId") REFERENCES "InvProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

