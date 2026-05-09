-- Migration: drop ChannelProduct.productId + fix ProductListing unique constraint
-- 작업 순서:
--   1. orphan listing 4건을 ChannelProduct 1개로 묶기
--   2. ProductListing unique 변경: (channelId, managementName) → (channelProductId, managementName)
--   3. ChannelProduct.productId 컬럼/FK/인덱스 제거

-- Step 1: orphan listing 4건(캡나시 3장 세트 #2 화이트×2 + 블랙×1) → ChannelProduct 1개 생성 후 연결
DO $$
DECLARE
  new_cp_id text := 'cm_migration_capnasi_set2';
  first_pid text;
BEGIN
  -- 이미 실행된 경우 스킵 (idempotent)
  IF EXISTS (SELECT 1 FROM "ChannelProduct" WHERE id = new_cp_id) THEN
    RETURN;
  END IF;

  -- orphan listing의 대표 productId 추출
  SELECT op."productId" INTO first_pid
  FROM "ProductListingItem" i
  JOIN "InvProductOption" op ON op.id = i."optionId"
  WHERE i."listingId" = 'cmoxpuzqy000004ie2asb31sk'
  LIMIT 1;

  -- ChannelProduct 생성
  INSERT INTO "ChannelProduct" (id, "spaceId", "channelId", "productId", "baseSearchName", "createdAt", "updatedAt")
  SELECT
    new_cp_id,
    "spaceId",
    "channelId",
    first_pid,
    '캡나시 3장 세트 #2 화이트×2 + 블랙×1',
    NOW(),
    NOW()
  FROM "ProductListing"
  WHERE id = 'cmoxpuzqy000004ie2asb31sk';

  -- orphan 4건을 새 ChannelProduct에 연결
  UPDATE "ProductListing"
  SET "channelProductId" = new_cp_id
  WHERE id IN (
    'cmoxpuzqy000004ie2asb31sk',
    'cmoxpv02g000304iei0zfc9sr',
    'cmoxpv0b0000604ie1idqcx2y',
    'cmoxpv0ju000904iejlq718ag'
  );
END $$;

-- Step 2: ProductListing unique 변경
-- 기존: (channelId, managementName) → 신규: (channelProductId, managementName)
ALTER TABLE "ProductListing" DROP CONSTRAINT IF EXISTS "ProductListing_channelId_managementName_key";

CREATE UNIQUE INDEX IF NOT EXISTS "ProductListing_channelProductId_managementName_key"
  ON "ProductListing"("channelProductId", "managementName");

-- Step 3: ChannelProduct.productId 컬럼/FK/인덱스 제거
ALTER TABLE "ChannelProduct" DROP CONSTRAINT IF EXISTS "ChannelProduct_productId_fkey";
DROP INDEX IF EXISTS "ChannelProduct_productId_channelId_idx";
ALTER TABLE "ChannelProduct" DROP COLUMN IF EXISTS "productId";
