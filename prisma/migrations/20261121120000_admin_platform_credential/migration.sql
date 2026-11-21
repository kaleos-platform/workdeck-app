-- CreateTable
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encryptedPayload" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "config" JSONB,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCredential_provider_key" ON "PlatformCredential"("provider");

-- 운영 Supabase 노출 차단(anon/authenticated 정책 없음 = 접근 불가). Prisma 는 소유자 권한이라 영향 없음.
ALTER TABLE "PlatformCredential" ENABLE ROW LEVEL SECURITY;
