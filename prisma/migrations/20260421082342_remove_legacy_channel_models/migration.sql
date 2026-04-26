-- Phase 3: 구 채널 모델 DROP + newChannelId → channelId rename
-- InvSalesChannel, InvChannelGroup, DelSalesChannel, DelChannelGroup, DelChannelType 제거

-- ── InvMovement ─────────────────────────────────────────────────────────────

-- 1. 기존 구 채널 FK 제거 (InvSalesChannel)
ALTER TABLE "InvMovement" DROP CONSTRAINT IF EXISTS "InvMovement_channelId_fkey";

-- 2. 기존 구 channelId 컬럼 제거
ALTER TABLE "InvMovement" DROP COLUMN IF EXISTS "channelId";

-- 3. 기존 신 채널 FK 제거 (rename 전에 제거)
ALTER TABLE "InvMovement" DROP CONSTRAINT IF EXISTS "InvMovement_newChannelId_fkey";

-- 4. newChannelId → channelId rename
ALTER TABLE "InvMovement" RENAME COLUMN "newChannelId" TO "channelId";

-- 5. 새 FK 추가
ALTER TABLE "InvMovement" ADD CONSTRAINT "InvMovement_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── DelOrder ─────────────────────────────────────────────────────────────────

-- 6. 기존 구 채널 FK 제거 (DelSalesChannel)
ALTER TABLE "DelOrder" DROP CONSTRAINT IF EXISTS "DelOrder_channelId_fkey";

-- 7. 기존 구 channelId 컬럼 제거
ALTER TABLE "DelOrder" DROP COLUMN IF EXISTS "channelId";

-- 8. 기존 신 채널 FK 제거
ALTER TABLE "DelOrder" DROP CONSTRAINT IF EXISTS "DelOrder_newChannelId_fkey";

-- 9. newChannelId → channelId rename
ALTER TABLE "DelOrder" RENAME COLUMN "newChannelId" TO "channelId";

-- 10. 새 FK 추가
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 구 모델 DROP ──────────────────────────────────────────────────────────────

-- InvSalesChannel (movements FK가 이미 제거됐으므로 바로 DROP)
DROP TABLE IF EXISTS "InvSalesChannel";

-- InvChannelGroup (InvSalesChannel.groupId FK가 없어졌으므로 바로 DROP)
DROP TABLE IF EXISTS "InvChannelGroup";

-- DelSalesChannel (DelOrder.channelId FK가 이미 제거됐으므로 바로 DROP)
DROP TABLE IF EXISTS "DelSalesChannel";

-- DelChannelGroup (DelSalesChannel.groupId FK가 없어졌으므로 바로 DROP)
DROP TABLE IF EXISTS "DelChannelGroup";

-- ── DelChannelType enum DROP ──────────────────────────────────────────────────
DROP TYPE IF EXISTS "DelChannelType";
