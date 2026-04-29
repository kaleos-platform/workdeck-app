-- ─── Sales Content Deck (AI 어댑터) ─────────────────────────────────────────
-- Claude Code ACP / Ollama / Gemini 어댑터의 월간 이미지 크레딧 + 생성 이력.
-- 모두 spaceId 격리, cascade on delete.

-- Enum
CREATE TYPE "AiGenerationStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- WorkspaceAiCredit: (spaceId, yearMonth) 단위 카운터
CREATE TABLE "WorkspaceAiCredit" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "imageUsed" INTEGER NOT NULL DEFAULT 0,
    "imageQuota" INTEGER NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceAiCredit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceAiCredit_spaceId_yearMonth_key"
    ON "WorkspaceAiCredit"("spaceId", "yearMonth");
CREATE INDEX "WorkspaceAiCredit_spaceId_idx" ON "WorkspaceAiCredit"("spaceId");

ALTER TABLE "WorkspaceAiCredit"
    ADD CONSTRAINT "WorkspaceAiCredit_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ImageGenerationLog: Gemini 호출 이력 (reservationId = id)
CREATE TABLE "ImageGenerationLog" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT,
    "aspectRatio" TEXT,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "outputCount" INTEGER NOT NULL DEFAULT 0,
    "creditMonth" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageGenerationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImageGenerationLog_spaceId_createdAt_idx"
    ON "ImageGenerationLog"("spaceId", "createdAt");
CREATE INDEX "ImageGenerationLog_status_idx" ON "ImageGenerationLog"("status");

ALTER TABLE "ImageGenerationLog"
    ADD CONSTRAINT "ImageGenerationLog_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- TextGenerationLog: Claude Code ACP / Ollama 호출 이력
CREATE TABLE "TextGenerationLog" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "responseFormat" TEXT,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "contentPreview" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TextGenerationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TextGenerationLog_spaceId_createdAt_idx"
    ON "TextGenerationLog"("spaceId", "createdAt");
CREATE INDEX "TextGenerationLog_status_idx" ON "TextGenerationLog"("status");

ALTER TABLE "TextGenerationLog"
    ADD CONSTRAINT "TextGenerationLog_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
