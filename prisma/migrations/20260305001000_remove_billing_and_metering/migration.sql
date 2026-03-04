-- 과금/구독/미터링 기능 제거
-- 운영 데이터가 없는 상태를 전제로 관련 스키마를 완전 정리한다.

-- DropForeignKey
ALTER TABLE "BillingEvent" DROP CONSTRAINT IF EXISTS "BillingEvent_spaceId_fkey";
ALTER TABLE "MeterEvent" DROP CONSTRAINT IF EXISTS "MeterEvent_spaceId_fkey";

-- DropTable
DROP TABLE IF EXISTS "BillingEvent";
DROP TABLE IF EXISTS "MeterEvent";

-- DropIndex
DROP INDEX IF EXISTS "Space_stripeCustomerId_key";
DROP INDEX IF EXISTS "Space_stripeSubscriptionId_key";

-- AlterTable
ALTER TABLE "Space"
  DROP COLUMN IF EXISTS "stripeCustomerId",
  DROP COLUMN IF EXISTS "stripeSubscriptionId",
  DROP COLUMN IF EXISTS "currentPlan",
  DROP COLUMN IF EXISTS "planExpiresAt";

-- DropEnum
DROP TYPE IF EXISTS "PlanType";
