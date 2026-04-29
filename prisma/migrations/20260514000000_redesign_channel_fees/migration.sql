-- Redesign channel fees: drop Channel.defaultFeePct, drop ChannelFeeRate.vatIncluded
-- Backfill all existing channels with a "기본" ChannelFeeRate row migrated from defaultFeePct

-- 1. Backfill: ensure every Channel has a "기본" ChannelFeeRate (ratePercent = defaultFeePct * 100)
INSERT INTO "ChannelFeeRate" (id, "channelId", "categoryName", "ratePercent", "createdAt", "updatedAt")
SELECT
  'cfeeseed_' || c.id,
  c.id,
  '기본',
  COALESCE(c."defaultFeePct" * 100, 0),
  NOW(),
  NOW()
FROM "Channel" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ChannelFeeRate" fr
  WHERE fr."channelId" = c.id AND fr."categoryName" = '기본'
);

-- 2. Drop Channel.defaultFeePct (data already migrated above)
ALTER TABLE "Channel" DROP COLUMN "defaultFeePct";

-- 3. Drop ChannelFeeRate.vatIncluded (channel-level vatIncludedInFee is now single source of truth)
ALTER TABLE "ChannelFeeRate" DROP COLUMN "vatIncluded";
