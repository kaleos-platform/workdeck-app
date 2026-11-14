-- CreateTable
CREATE TABLE "SpaceDeckAccess" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "deckAppId" TEXT NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "exemptFlag" BOOLEAN NOT NULL DEFAULT false,
    "exemptNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceDeckAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpaceDeckAccess_spaceId_deckAppId_key" ON "SpaceDeckAccess"("spaceId", "deckAppId");

-- AddForeignKey
ALTER TABLE "SpaceDeckAccess" ADD CONSTRAINT "SpaceDeckAccess_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceDeckAccess" ADD CONSTRAINT "SpaceDeckAccess_deckAppId_fkey" FOREIGN KEY ("deckAppId") REFERENCES "BillingDeckProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 업무별 체험·면제는 서버에서만 접근한다. Data API에는 노출하지 않는다.
ALTER TABLE "SpaceDeckAccess" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "SpaceDeckAccess" FROM anon, authenticated;

-- 기존 체험은 설치 이력이 있는 유료 업무에만 동일한 종료일로 보존한다.
-- 새 업무는 공간의 과거 체험과 무관하게 별도의 최초 체험을 시작한다.
INSERT INTO "SpaceDeckAccess" ("id", "spaceId", "deckAppId", "trialEndsAt", "createdAt", "updatedAt")
SELECT 'legacy_' || md5(d."spaceId" || ':' || d."deckAppId"), d."spaceId", d."deckAppId", s."trialEndsAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "DeckInstance" d
JOIN "SpaceSubscription" s ON s."spaceId" = d."spaceId"
JOIN "BillingDeckProduct" p ON p.id = d."deckAppId"
WHERE s."trialEndsAt" IS NOT NULL AND p."pricingMode" = 'SUBSCRIPTION'
ON CONFLICT ("spaceId", "deckAppId") DO NOTHING;
