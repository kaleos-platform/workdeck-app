-- 채널 모델 단순화: kind/channelType enum + ChannelGroup 제거,
-- 사용자 정의 ChannelTypeDef + Channel.useSimulation 도입.
-- 실행 순서:
--   1) 새 ChannelTypeDef 테이블 생성
--   2) 각 Space별 시스템 시드 4개 (B2C, B2B, 내부 이관, 기타)
--   3) Channel에 channelTypeDefId, useSimulation 추가
--   4) 기존 kind/channelType → channelTypeDefId 백필
--   5) 레거시 컬럼/제약/테이블/enum 드롭

-- 1) ChannelTypeDef 테이블 ────────────────────────────────────────────────
CREATE TABLE "ChannelTypeDef" (
  "id"             TEXT         NOT NULL,
  "spaceId"        TEXT         NOT NULL,
  "name"           TEXT         NOT NULL,
  "isSalesChannel" BOOLEAN      NOT NULL DEFAULT true,
  "isSystem"       BOOLEAN      NOT NULL DEFAULT false,
  "sortOrder"      INTEGER      NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelTypeDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelTypeDef_spaceId_name_key" ON "ChannelTypeDef"("spaceId", "name");
CREATE INDEX "ChannelTypeDef_spaceId_idx" ON "ChannelTypeDef"("spaceId");

ALTER TABLE "ChannelTypeDef" ADD CONSTRAINT "ChannelTypeDef_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) 시스템 시드 (Space마다 4개) ──────────────────────────────────────────
INSERT INTO "ChannelTypeDef" ("id", "spaceId", "name", "isSalesChannel", "isSystem", "sortOrder", "updatedAt")
SELECT 'cseed_b2c_'   || s."id", s."id", 'B2C',     true,  true, 0, CURRENT_TIMESTAMP FROM "Space" s
ON CONFLICT ("spaceId", "name") DO NOTHING;

INSERT INTO "ChannelTypeDef" ("id", "spaceId", "name", "isSalesChannel", "isSystem", "sortOrder", "updatedAt")
SELECT 'cseed_b2b_'   || s."id", s."id", 'B2B',     true,  true, 1, CURRENT_TIMESTAMP FROM "Space" s
ON CONFLICT ("spaceId", "name") DO NOTHING;

INSERT INTO "ChannelTypeDef" ("id", "spaceId", "name", "isSalesChannel", "isSystem", "sortOrder", "updatedAt")
SELECT 'cseed_xfer_'  || s."id", s."id", '내부 이관', false, true, 2, CURRENT_TIMESTAMP FROM "Space" s
ON CONFLICT ("spaceId", "name") DO NOTHING;

INSERT INTO "ChannelTypeDef" ("id", "spaceId", "name", "isSalesChannel", "isSystem", "sortOrder", "updatedAt")
SELECT 'cseed_other_' || s."id", s."id", '기타',    true,  true, 3, CURRENT_TIMESTAMP FROM "Space" s
ON CONFLICT ("spaceId", "name") DO NOTHING;

-- 3) Channel 새 컬럼 ──────────────────────────────────────────────────────
ALTER TABLE "Channel" ADD COLUMN "channelTypeDefId" TEXT;
ALTER TABLE "Channel" ADD COLUMN "useSimulation"    BOOLEAN NOT NULL DEFAULT true;

-- 4) 백필 (우선순위: INTERNAL_TRANSFER > WHOLESALE > 기본 B2C) ───────────
UPDATE "Channel" c SET "channelTypeDefId" = (
  SELECT t."id" FROM "ChannelTypeDef" t
  WHERE t."spaceId" = c."spaceId" AND t."name" = '내부 이관' AND t."isSystem" = true
)
WHERE c."kind" = 'INTERNAL_TRANSFER';

UPDATE "Channel" c SET "channelTypeDefId" = (
  SELECT t."id" FROM "ChannelTypeDef" t
  WHERE t."spaceId" = c."spaceId" AND t."name" = 'B2B' AND t."isSystem" = true
)
WHERE c."channelType" = 'WHOLESALE' AND c."channelTypeDefId" IS NULL;

UPDATE "Channel" c SET "channelTypeDefId" = (
  SELECT t."id" FROM "ChannelTypeDef" t
  WHERE t."spaceId" = c."spaceId" AND t."name" = 'B2C' AND t."isSystem" = true
)
WHERE c."channelTypeDefId" IS NULL;

-- 5) Channel FK 및 인덱스 ─────────────────────────────────────────────────
CREATE INDEX "Channel_channelTypeDefId_idx" ON "Channel"("channelTypeDefId");

ALTER TABLE "Channel" ADD CONSTRAINT "Channel_channelTypeDefId_fkey"
  FOREIGN KEY ("channelTypeDefId") REFERENCES "ChannelTypeDef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) 레거시 제거 ──────────────────────────────────────────────────────────
DROP INDEX IF EXISTS "Channel_groupId_idx";
ALTER TABLE "Channel" DROP CONSTRAINT IF EXISTS "Channel_groupId_fkey";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "groupId";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "Channel" DROP COLUMN IF EXISTS "channelType";

DROP TABLE IF EXISTS "ChannelGroup";

DROP TYPE IF EXISTS "ChannelKind";
DROP TYPE IF EXISTS "ChannelType";
