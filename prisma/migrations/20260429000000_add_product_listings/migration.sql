-- Feature #8: 판매채널 상품 (ProductListing) + 배송 fulfillment 팬아웃
-- expand 단계: 기존 FK 무변경, 신규 테이블 3개 + DelOrderItem/ChannelProductAlias 확장.

-- 1) 판매채널 상품 상태 enum
CREATE TYPE "ProductListingStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- 2) ProductListing 테이블
CREATE TABLE "ProductListing" (
  "id"           TEXT NOT NULL,
  "spaceId"      TEXT NOT NULL,
  "channelId"    TEXT NOT NULL,
  "internalCode" TEXT,
  "searchName"   TEXT NOT NULL,
  "displayName"  TEXT NOT NULL,
  "keywords"     JSONB NOT NULL DEFAULT '[]'::jsonb,
  "retailPrice"  DECIMAL(18,2),
  "status"       "ProductListingStatus" NOT NULL DEFAULT 'ACTIVE',
  "memo"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductListing_channelId_searchName_key" ON "ProductListing"("channelId", "searchName");
CREATE INDEX "ProductListing_spaceId_channelId_idx" ON "ProductListing"("spaceId", "channelId");
CREATE INDEX "ProductListing_status_idx" ON "ProductListing"("status");

ALTER TABLE "ProductListing"
  ADD CONSTRAINT "ProductListing_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductListing"
  ADD CONSTRAINT "ProductListing_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) ProductListingItem 테이블
CREATE TABLE "ProductListingItem" (
  "id"        TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "optionId"  TEXT NOT NULL,
  "quantity"  INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "ProductListingItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductListingItem_listingId_optionId_key" ON "ProductListingItem"("listingId", "optionId");
CREATE INDEX "ProductListingItem_optionId_idx" ON "ProductListingItem"("optionId");

ALTER TABLE "ProductListingItem"
  ADD CONSTRAINT "ProductListingItem_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductListingItem"
  ADD CONSTRAINT "ProductListingItem_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) DelOrderItemFulfillment 테이블
CREATE TABLE "DelOrderItemFulfillment" (
  "id"          TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "optionId"    TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL,

  CONSTRAINT "DelOrderItemFulfillment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DelOrderItemFulfillment_orderItemId_idx" ON "DelOrderItemFulfillment"("orderItemId");
CREATE INDEX "DelOrderItemFulfillment_optionId_idx" ON "DelOrderItemFulfillment"("optionId");

ALTER TABLE "DelOrderItemFulfillment"
  ADD CONSTRAINT "DelOrderItemFulfillment_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "DelOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DelOrderItemFulfillment"
  ADD CONSTRAINT "DelOrderItemFulfillment_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5) DelOrderItem 확장: listingId
ALTER TABLE "DelOrderItem" ADD COLUMN "listingId" TEXT;

CREATE INDEX "DelOrderItem_listingId_idx" ON "DelOrderItem"("listingId");

ALTER TABLE "DelOrderItem"
  ADD CONSTRAINT "DelOrderItem_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 6) ChannelProductAlias 확장: optionId nullable + listingId + 대상 필수 CHECK
ALTER TABLE "ChannelProductAlias" ALTER COLUMN "optionId" DROP NOT NULL;

-- 기존 FK 재정의 (optionId가 NULL 가능해졌지만 onDelete 규칙은 유지)
ALTER TABLE "ChannelProductAlias" DROP CONSTRAINT "ChannelProductAlias_optionId_fkey";
ALTER TABLE "ChannelProductAlias"
  ADD CONSTRAINT "ChannelProductAlias_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProductAlias" ADD COLUMN "listingId" TEXT;

CREATE INDEX "ChannelProductAlias_listingId_idx" ON "ChannelProductAlias"("listingId");

ALTER TABLE "ChannelProductAlias"
  ADD CONSTRAINT "ChannelProductAlias_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "ProductListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProductAlias"
  ADD CONSTRAINT "ChannelProductAlias_target_required_check"
  CHECK ("optionId" IS NOT NULL OR "listingId" IS NOT NULL);
