-- Sales Content Deck — 도메인 모델 재설계 (MVP-1)
--
-- 운영 사용자 0명 확인 — DB 폐기 자유. 워커는 API contract 만 의존하므로
-- ContentDeployment / DeploymentMetric / ContentClickEvent / SalesContentChannel /
-- ChannelCredential / SalesContentJob / ContentAsset / ContentVersion 의 핵심 필드는 보존.
--
-- 변경 요약:
--   1. DROP TABLE: B2BProduct, ContentIdea (재설계)
--   2. ALTER Persona/BrandProfile/Template: 잉여 필드 제거 + customFields JSON 추가
--   3. ALTER Content: templateId/productId/personaId 제거, body/urlSlug/targetKeyword/relatedKeywords 추가
--   4. CREATE TABLE: Product, ProductPersona, Ideation, IdeationProduct

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. DROP TABLEs (CASCADE 로 FK 자동 정리)
-- ──────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS "ContentIdea" CASCADE;
DROP TABLE IF EXISTS "B2BProduct" CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. ALTER Persona — 잉여 필드 제거 + customFields 추가
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Persona"
  DROP CONSTRAINT IF EXISTS "Persona_spaceId_slug_key";

ALTER TABLE "Persona"
  DROP COLUMN IF EXISTS "slug",
  DROP COLUMN IF EXISTS "companySize",
  DROP COLUMN IF EXISTS "seniority",
  DROP COLUMN IF EXISTS "decisionRole",
  DROP COLUMN IF EXISTS "goals",
  DROP COLUMN IF EXISTS "painPoints",
  DROP COLUMN IF EXISTS "objections",
  DROP COLUMN IF EXISTS "preferredChannels",
  DROP COLUMN IF EXISTS "toneHints",
  ADD COLUMN  IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '[]';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. ALTER BrandProfile — 잉여 필드 제거 + customFields 추가
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE "BrandProfile"
  DROP COLUMN IF EXISTS "missionStatement",
  DROP COLUMN IF EXISTS "forbiddenPhrases",
  DROP COLUMN IF EXISTS "preferredPhrases",
  DROP COLUMN IF EXISTS "styleGuideUrl",
  DROP COLUMN IF EXISTS "primaryColor",
  DROP COLUMN IF EXISTS "secondaryColor",
  DROP COLUMN IF EXISTS "logoUrl",
  ADD COLUMN  IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '[]';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. ALTER Template — slug 제거 (MVP-6 까지 minimal)
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Template"
  DROP CONSTRAINT IF EXISTS "Template_spaceId_slug_key";

ALTER TABLE "Template"
  DROP COLUMN IF EXISTS "slug";

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. ALTER Content — templateId/productId/personaId 제거, 신규 필드 추가
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Content"
  DROP COLUMN IF EXISTS "templateId",
  DROP COLUMN IF EXISTS "productId",
  DROP COLUMN IF EXISTS "personaId",
  ADD COLUMN  IF NOT EXISTS "body" TEXT,
  ADD COLUMN  IF NOT EXISTS "urlSlug" TEXT,
  ADD COLUMN  IF NOT EXISTS "targetKeyword" TEXT,
  ADD COLUMN  IF NOT EXISTS "relatedKeywords" JSONB NOT NULL DEFAULT '[]';

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. CREATE TABLE Product (B2BProduct 대체, 단순화 + customFields)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "Product" (
    "id"            TEXT NOT NULL,
    "spaceId"       TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "oneLinerPitch" TEXT,
    "customFields"  JSONB NOT NULL DEFAULT '[]',
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Product_spaceId_idx" ON "Product"("spaceId");
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. CREATE TABLE ProductPersona (M:N junction)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ProductPersona" (
    "productId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPersona_pkey" PRIMARY KEY ("productId", "personaId")
);
CREATE INDEX "ProductPersona_productId_idx" ON "ProductPersona"("productId");
CREATE INDEX "ProductPersona_personaId_idx" ON "ProductPersona"("personaId");
ALTER TABLE "ProductPersona"
  ADD CONSTRAINT "ProductPersona_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductPersona"
  ADD CONSTRAINT "ProductPersona_personaId_fkey"
  FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. CREATE TABLE Ideation (ContentIdea 대체, 새 shape)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "Ideation" (
    "id"              TEXT NOT NULL,
    "spaceId"         TEXT NOT NULL,
    "userId"          TEXT,
    "personaId"       TEXT NOT NULL,
    "targetKeywords"  JSONB NOT NULL DEFAULT '[]',
    "ideas"           JSONB NOT NULL DEFAULT '[]',
    "generatedBy"     "IdeaGeneratedBy" NOT NULL,
    "providerName"    TEXT,
    "providerModel"   TEXT,
    "latencyMs"       INTEGER,
    "promptTraceHash" TEXT,
    "ruleIdsSnapshot" JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ideation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Ideation_spaceId_createdAt_idx" ON "Ideation"("spaceId", "createdAt");
CREATE INDEX "Ideation_personaId_idx" ON "Ideation"("personaId");
ALTER TABLE "Ideation"
  ADD CONSTRAINT "Ideation_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ideation"
  ADD CONSTRAINT "Ideation_personaId_fkey"
  FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. CREATE TABLE IdeationProduct (M:N junction)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE "IdeationProduct" (
    "ideationId" TEXT NOT NULL,
    "productId"  TEXT NOT NULL,
    CONSTRAINT "IdeationProduct_pkey" PRIMARY KEY ("ideationId", "productId")
);
CREATE INDEX "IdeationProduct_ideationId_idx" ON "IdeationProduct"("ideationId");
CREATE INDEX "IdeationProduct_productId_idx" ON "IdeationProduct"("productId");
ALTER TABLE "IdeationProduct"
  ADD CONSTRAINT "IdeationProduct_ideationId_fkey"
  FOREIGN KEY ("ideationId") REFERENCES "Ideation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdeationProduct"
  ADD CONSTRAINT "IdeationProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
