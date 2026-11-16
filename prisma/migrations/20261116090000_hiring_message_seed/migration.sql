-- 자주 쓰는 메시지 예시 자동 추가 기록(공간당 1회)
CREATE TABLE IF NOT EXISTS "HiringMessageSeed" (
    "spaceId" TEXT NOT NULL,
    "seededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiringMessageSeed_pkey" PRIMARY KEY ("spaceId")
);

DO $$ BEGIN
  ALTER TABLE "HiringMessageSeed" ADD CONSTRAINT "HiringMessageSeed_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Data API 잠금
ALTER TABLE "HiringMessageSeed" ENABLE ROW LEVEL SECURITY;
