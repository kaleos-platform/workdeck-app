-- ─── Sales Content Deck (정보 세팅) ──────────────────────────────────────────
-- B2B 마케팅 콘텐츠 제작을 위한 판매 상품·페르소나·브랜드 프로필 3종.
-- 모두 spaceId로 격리되며 cascade on delete.

-- B2BProduct: 마케팅 맥락의 판매 상품 (InvProduct와 별개 엔터티)
CREATE TABLE "B2BProduct" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "oneLinerPitch" TEXT,
    "valueProposition" TEXT,
    "targetCustomers" TEXT,
    "keyFeatures" JSONB,
    "differentiators" JSONB,
    "painPointsAddressed" JSONB,
    "proofPoints" JSONB,
    "pricingModel" TEXT,
    "priceMin" DECIMAL(18,2),
    "priceMax" DECIMAL(18,2),
    "ctaTargetUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sourceInvProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B2BProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "B2BProduct_spaceId_slug_key" ON "B2BProduct"("spaceId", "slug");
CREATE INDEX "B2BProduct_spaceId_idx" ON "B2BProduct"("spaceId");

ALTER TABLE "B2BProduct"
    ADD CONSTRAINT "B2BProduct_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Persona: B2B/B2G 타겟 의사결정자 프로파일
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "jobTitle" TEXT,
    "industry" TEXT,
    "companySize" TEXT,
    "seniority" TEXT,
    "decisionRole" TEXT,
    "goals" JSONB,
    "painPoints" JSONB,
    "objections" JSONB,
    "preferredChannels" JSONB,
    "toneHints" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Persona_spaceId_slug_key" ON "Persona"("spaceId", "slug");
CREATE INDEX "Persona_spaceId_idx" ON "Persona"("spaceId");

ALTER TABLE "Persona"
    ADD CONSTRAINT "Persona_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BrandProfile: Space당 1개 (unique spaceId)
CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "shortDescription" TEXT,
    "missionStatement" TEXT,
    "toneOfVoice" JSONB,
    "forbiddenPhrases" JSONB,
    "preferredPhrases" JSONB,
    "styleGuideUrl" TEXT,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandProfile_spaceId_key" ON "BrandProfile"("spaceId");

ALTER TABLE "BrandProfile"
    ADD CONSTRAINT "BrandProfile_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
