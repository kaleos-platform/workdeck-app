-- CreateEnum
CREATE TYPE "FinAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "FinAccount" ADD COLUMN     "status" "FinAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FinLiabilitySnapshot" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "liabilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinLiabilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FinLiabilitySnapshot_spaceId_idx" ON "FinLiabilitySnapshot"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinLiabilitySnapshot_spaceId_liabilityId_yearMonth_key" ON "FinLiabilitySnapshot"("spaceId", "liabilityId", "yearMonth");

-- 신규 테이블은 RLS 를 켠다(앱은 서비스 롤로 접근 — Supabase 공개 API 노출 차단).
ALTER TABLE "FinLiabilitySnapshot" ENABLE ROW LEVEL SECURITY;

-- AddForeignKey
ALTER TABLE "FinLiabilitySnapshot" ADD CONSTRAINT "FinLiabilitySnapshot_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: 기존 부채의 현재 잔액을 이번 달(KST) 스냅샷으로 기록 — 순자산 추이의 시작점.
INSERT INTO "FinLiabilitySnapshot" ("id", "spaceId", "liabilityId", "name", "yearMonth", "balance", "updatedAt")
SELECT
  'c' || substr(md5(random()::text || clock_timestamp()::text || "id"), 1, 24),
  "spaceId",
  "id",
  "name",
  to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM'),
  "balance",
  CURRENT_TIMESTAMP
FROM "FinLiability";
