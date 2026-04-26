-- 수동 매칭 alias의 다중 fulfillment 자식 테이블
-- 우선순위: fulfillments[] > listingId > optionId (단일 옵션)

CREATE TABLE "ChannelProductAliasFulfillment" (
  "id"       TEXT NOT NULL,
  "aliasId"  TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "ChannelProductAliasFulfillment_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChannelProductAliasFulfillment"
  ADD CONSTRAINT "ChannelProductAliasFulfillment_aliasId_fkey"
  FOREIGN KEY ("aliasId") REFERENCES "ChannelProductAlias"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChannelProductAliasFulfillment"
  ADD CONSTRAINT "ChannelProductAliasFulfillment_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ChannelProductAliasFulfillment_aliasId_idx"
  ON "ChannelProductAliasFulfillment"("aliasId");

CREATE INDEX "ChannelProductAliasFulfillment_optionId_idx"
  ON "ChannelProductAliasFulfillment"("optionId");
