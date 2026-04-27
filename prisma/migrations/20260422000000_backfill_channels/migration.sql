-- ============================================================
-- 채널 백필: InvSalesChannel + DelSalesChannel → Channel (공용)
-- ============================================================
-- 이 마이그레이션은 스키마 변경 없이 데이터만 이동시킨다.
-- 구 테이블과 구 FK 컬럼(channelId)은 그대로 유지된다.
-- Phase 3 (switch_to_unified_channels)에서 구 테이블을 DROP하고
-- newChannelId를 channelId로 rename할 예정.
--
-- IDEMPOTENT 가드: 일부 환경(prod 신규 DB 등)에서는 이 백필 실행 시점에
-- 이미 legacy 테이블이 제거된 상태일 수 있다 (마이그레이션 이름 순서 ≠
-- 적용 의도 순서). 그런 경우 백필은 의미 없으므로 안전하게 skip한다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'InvChannelGroup') THEN
    RAISE NOTICE 'Legacy InvChannelGroup not found — skipping backfill (assume already migrated).';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'DelChannelGroup') THEN
    RAISE NOTICE 'Legacy DelChannelGroup not found — skipping backfill (assume already migrated).';
    RETURN;
  END IF;

  -- 1) ChannelGroup 백필
  INSERT INTO "ChannelGroup" (id, "spaceId", name, "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, "spaceId", name, NOW(), NOW()
  FROM (
    SELECT "spaceId", name FROM "InvChannelGroup"
    UNION
    SELECT "spaceId", name FROM "DelChannelGroup"
  ) AS u
  ON CONFLICT ("spaceId", name) DO NOTHING;

  -- 2) Channel 백필: Inv 채널
  INSERT INTO "Channel" (
    id, "spaceId", "groupId", name, kind, "isActive",
    "freeShipping", "usesMarketingBudget", "vatIncludedInFee",
    "requireOrderNumber", "requirePayment", "requireProducts",
    "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    ic."spaceId",
    cg.id,
    ic.name,
    'ONLINE_MARKETPLACE'::"ChannelKind",
    ic."isActive",
    false, false, true,
    true, true, true,
    ic."createdAt", NOW()
  FROM "InvSalesChannel" ic
  LEFT JOIN "InvChannelGroup" icg ON icg.id = ic."groupId"
  LEFT JOIN "ChannelGroup" cg ON cg."spaceId" = ic."spaceId" AND cg.name = icg.name
  ON CONFLICT ("spaceId", name) DO NOTHING;

  -- 3) Channel 백필: Del 채널
  INSERT INTO "Channel" (
    id, "spaceId", "groupId", name, kind, "isActive",
    "freeShipping", "usesMarketingBudget", "vatIncludedInFee",
    "requireOrderNumber", "requirePayment", "requireProducts",
    "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    dc."spaceId",
    cg.id,
    dc.name,
    CASE
      WHEN dc.type = 'TRANSFER' THEN 'INTERNAL_TRANSFER'::"ChannelKind"
      ELSE 'ONLINE_MARKETPLACE'::"ChannelKind"
    END,
    dc."isActive",
    false, false, true,
    dc."requireOrderNumber",
    dc."requirePayment",
    dc."requireProducts",
    dc."createdAt", NOW()
  FROM "DelSalesChannel" dc
  LEFT JOIN "DelChannelGroup" dcg ON dcg.id = dc."groupId"
  LEFT JOIN "ChannelGroup" cg ON cg."spaceId" = dc."spaceId" AND cg.name = dcg.name
  WHERE NOT EXISTS (
    SELECT 1 FROM "Channel" c
    WHERE c."spaceId" = dc."spaceId" AND c.name = dc.name
  );

  -- 4) InvMovement.newChannelId 백필 (newChannelId 컬럼이 존재할 때만)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InvMovement' AND column_name = 'newChannelId'
  ) THEN
    UPDATE "InvMovement" m
    SET "newChannelId" = c.id
    FROM "InvSalesChannel" isc
    JOIN "Channel" c ON c."spaceId" = isc."spaceId" AND c.name = isc.name
    WHERE m."channelId" = isc.id;
  END IF;

  -- 5) DelOrder.newChannelId 백필 (newChannelId 컬럼이 존재할 때만)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DelOrder' AND column_name = 'newChannelId'
  ) THEN
    UPDATE "DelOrder" o
    SET "newChannelId" = c.id
    FROM "DelSalesChannel" dsc
    JOIN "Channel" c ON c."spaceId" = dsc."spaceId" AND c.name = dsc.name
    WHERE o."channelId" = dsc.id;
  END IF;
END $$;
