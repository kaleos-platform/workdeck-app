-- ─── Sales Content Deck (아이데이션) ────────────────────────────────────────
-- 한 번의 아이데이션 실행 = ContentIdea 1행. 생성된 후보는 ideas(JSONB)에 배열로 저장.
-- product/persona 삭제 시 아이데이션 기록은 남기고 FK 만 NULL 로 (SetNull).

CREATE TYPE "IdeaGeneratedBy" AS ENUM ('USER', 'AI');

CREATE TABLE "ContentIdea" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT,
    "productId" TEXT,
    "personaId" TEXT,
    "userPromptInput" TEXT,
    "generatedBy" "IdeaGeneratedBy" NOT NULL,
    "ideas" JSONB NOT NULL,
    "promptTraceHash" TEXT,
    "ruleIdsSnapshot" JSONB,
    "providerName" TEXT,
    "providerModel" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentIdea_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentIdea_spaceId_createdAt_idx" ON "ContentIdea"("spaceId", "createdAt");
CREATE INDEX "ContentIdea_productId_idx" ON "ContentIdea"("productId");
CREATE INDEX "ContentIdea_personaId_idx" ON "ContentIdea"("personaId");

ALTER TABLE "ContentIdea"
    ADD CONSTRAINT "ContentIdea_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentIdea"
    ADD CONSTRAINT "ContentIdea_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "B2BProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ContentIdea"
    ADD CONSTRAINT "ContentIdea_personaId_fkey"
    FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;
