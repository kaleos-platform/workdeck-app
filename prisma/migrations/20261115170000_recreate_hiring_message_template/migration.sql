-- 지원자 자주 쓰는 메시지 복원 (20261115140000에서 DROP한 테이블을 lastUsedAt 없이 다시 생성)
CREATE TABLE IF NOT EXISTS "HiringMessageTemplate" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiringMessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HiringMessageTemplate_spaceId_idx" ON "HiringMessageTemplate"("spaceId");

DO $$ BEGIN
  ALTER TABLE "HiringMessageTemplate" ADD CONSTRAINT "HiringMessageTemplate_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
