-- Migration: 20260508000000_pricing_matrix_redesign
-- 가격 시뮬레이션 매트릭스 재설계 — Channel 확장, ProductPricingSettings 확장,
-- PricingScenario 확장, PricingScenarioItem optionId nullable + 신규 필드,
-- PricingScenarioChannel M-N 조인 테이블 추가

-- ─── 1. ChannelType enum 추가 ───────────────────────────────────────────────
CREATE TYPE "ChannelType" AS ENUM (
  'OPEN_MARKET',
  'DEPT_STORE',
  'SELF_MALL',
  'SOCIAL',
  'WHOLESALE',
  'OTHER'
);

-- ─── 2. PromotionType enum 추가 ─────────────────────────────────────────────
CREATE TYPE "PromotionType" AS ENUM (
  'NONE',
  'FLAT',
  'PERCENT',
  'COUPON'
);

-- ─── 3. Channel 신규 컬럼 추가 ──────────────────────────────────────────────
ALTER TABLE "Channel"
  ADD COLUMN "channelType"           "ChannelType"    NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "freeShippingThreshold" DECIMAL(18, 2),
  ADD COLUMN "defaultFeePct"         DECIMAL(6, 4),
  ADD COLUMN "applyAdCost"           BOOLEAN          NOT NULL DEFAULT FALSE,
  ADD COLUMN "paymentFeeIncluded"    BOOLEAN          NOT NULL DEFAULT TRUE,
  ADD COLUMN "paymentFeePct"         DECIMAL(6, 4);

-- ─── 4. ProductPricingSettings 신규 컬럼 추가 ───────────────────────────────
ALTER TABLE "ProductPricingSettings"
  ADD COLUMN "defaultChannelFeePct"  DECIMAL(6, 4)   NOT NULL DEFAULT 0,
  ADD COLUMN "defaultShippingCost"   DECIMAL(18, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "defaultReturnRate"     DECIMAL(6, 4)   NOT NULL DEFAULT 0,
  ADD COLUMN "defaultReturnShipping" DECIMAL(18, 2)  NOT NULL DEFAULT 0,
  ADD COLUMN "autoApplyChannelFee"   BOOLEAN         NOT NULL DEFAULT FALSE,
  ADD COLUMN "autoApplyAdCost"       BOOLEAN         NOT NULL DEFAULT FALSE,
  ADD COLUMN "autoApplyShipping"     BOOLEAN         NOT NULL DEFAULT FALSE;

-- ─── 5. PricingScenario 신규 컬럼 추가 ─────────────────────────────────────
ALTER TABLE "PricingScenario"
  ADD COLUMN "promotionType"          "PromotionType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "promotionValue"         DECIMAL(18, 4),
  ADD COLUMN "applyReturnAdjustment"  BOOLEAN         NOT NULL DEFAULT FALSE;

-- ─── 6. PricingScenarioItem — optionId nullable + 신규 컬럼 ─────────────────
-- 6-a. 기존 unique constraint 제거 (scenarioId, optionId) — optionId가 nullable이 되면 unique 의미 없음
ALTER TABLE "PricingScenarioItem"
  DROP CONSTRAINT IF EXISTS "PricingScenarioItem_scenarioId_optionId_key";

-- 6-b. optionId NOT NULL → nullable
ALTER TABLE "PricingScenarioItem"
  ALTER COLUMN "optionId" DROP NOT NULL;

-- 6-c. 신규 컬럼 추가
ALTER TABLE "PricingScenarioItem"
  ADD COLUMN "manualName"      TEXT,
  ADD COLUMN "manualBrandName" TEXT,
  ADD COLUMN "unitsPerSet"     INTEGER NOT NULL DEFAULT 1;

-- 6-d. CHECK: optionId가 null이면 manualName 필수
ALTER TABLE "PricingScenarioItem"
  ADD CONSTRAINT "PricingScenarioItem_option_or_manual_chk"
    CHECK (
      "optionId" IS NOT NULL
      OR ("manualName" IS NOT NULL AND "manualName" <> '')
    );

-- ─── 7. PricingScenarioChannel 조인 테이블 생성 ─────────────────────────────
CREATE TABLE "PricingScenarioChannel" (
  "id"         TEXT        NOT NULL,
  "scenarioId" TEXT        NOT NULL,
  "channelId"  TEXT        NOT NULL,
  "sortOrder"  INTEGER     NOT NULL DEFAULT 0,

  CONSTRAINT "PricingScenarioChannel_pkey"               PRIMARY KEY ("id"),
  CONSTRAINT "PricingScenarioChannel_scenarioId_fkey"    FOREIGN KEY ("scenarioId")
    REFERENCES "PricingScenario"("id") ON DELETE CASCADE,
  CONSTRAINT "PricingScenarioChannel_channelId_fkey"     FOREIGN KEY ("channelId")
    REFERENCES "Channel"("id") ON DELETE CASCADE,
  CONSTRAINT "PricingScenarioChannel_scenarioId_channelId_key"
    UNIQUE ("scenarioId", "channelId")
);

CREATE INDEX "PricingScenarioChannel_scenarioId_idx" ON "PricingScenarioChannel"("scenarioId");
CREATE INDEX "PricingScenarioChannel_channelId_idx"  ON "PricingScenarioChannel"("channelId");

-- ─── 8. 백필: 기존 PricingScenario.channelId → PricingScenarioChannel ───────
-- channelId가 설정된 기존 시나리오 행을 M-N 테이블로 마이그레이션
INSERT INTO "PricingScenarioChannel" ("id", "scenarioId", "channelId", "sortOrder")
SELECT
  gen_random_uuid()::text,
  ps."id",
  ps."channelId",
  0
FROM "PricingScenario" ps
WHERE ps."channelId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "PricingScenarioChannel" psc
    WHERE psc."scenarioId" = ps."id" AND psc."channelId" = ps."channelId"
  );
