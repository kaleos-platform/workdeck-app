-- ─── Sales Content Deck (개선 규칙 · 셀프-임프루빙) ──────────────────────────

CREATE TYPE "RuleSource" AS ENUM ('USER', 'AI');
CREATE TYPE "RuleStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "RuleScope" AS ENUM ('WORKSPACE', 'PRODUCT', 'PERSONA', 'CHANNEL', 'COMBINATION');

CREATE TABLE "ImprovementRule" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "scope" "RuleScope" NOT NULL,
    "source" "RuleSource" NOT NULL DEFAULT 'USER',
    "status" "RuleStatus" NOT NULL DEFAULT 'PROPOSED',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 5,
    "targetProductId" TEXT,
    "targetPersonaId" TEXT,
    "targetChannelId" TEXT,
    "evidenceDeploymentIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImprovementRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImprovementRule_spaceId_status_idx" ON "ImprovementRule"("spaceId", "status");
CREATE INDEX "ImprovementRule_spaceId_scope_status_idx"
    ON "ImprovementRule"("spaceId", "scope", "status");

ALTER TABLE "ImprovementRule"
    ADD CONSTRAINT "ImprovementRule_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
