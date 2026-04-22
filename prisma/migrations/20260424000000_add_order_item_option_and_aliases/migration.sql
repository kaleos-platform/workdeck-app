-- Phase A: 배송 주문 아이템에 옵션 FK 추가 + 채널별 상품 별칭 사전
ALTER TABLE "DelOrderItem"
  ADD COLUMN "optionId" TEXT;

ALTER TABLE "DelOrderItem"
  ADD CONSTRAINT "DelOrderItem_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DelOrderItem_optionId_idx" ON "DelOrderItem"("optionId");

CREATE TABLE "ChannelProductAlias" (
  "id"        TEXT NOT NULL,
  "spaceId"   TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "aliasName" TEXT NOT NULL,
  "optionId"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelProductAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelProductAlias_channelId_aliasName_key"
  ON "ChannelProductAlias"("channelId", "aliasName");
CREATE INDEX "ChannelProductAlias_spaceId_idx"  ON "ChannelProductAlias"("spaceId");
CREATE INDEX "ChannelProductAlias_optionId_idx" ON "ChannelProductAlias"("optionId");

ALTER TABLE "ChannelProductAlias"
  ADD CONSTRAINT "ChannelProductAlias_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProductAlias"
  ADD CONSTRAINT "ChannelProductAlias_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProductAlias"
  ADD CONSTRAINT "ChannelProductAlias_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
