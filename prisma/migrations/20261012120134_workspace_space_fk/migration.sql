-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "spaceId" TEXT;

-- 백필 1순위: 로켓그로스 위치 연결축(InvStorageLocation.externalIntegrationKey = workspaceId).
-- 실제 쿠팡 데이터가 있는 Space다. (spaceId, externalSource)가 unique라 Space 하나에 Workspace는 최대 1개다.
-- 같은 키를 여러 Space의 활성 위치가 쓰면 어느 Space인지 결정할 수 없으므로 연결하지 않는다
-- (resolveCoupangWorkspaceForSpaceStrict와 같은 규칙). 그런 Workspace는 2순위 또는 명시적 매핑으로 넘긴다.
UPDATE "Workspace" w
SET "spaceId" = l."spaceId"
FROM (
  SELECT "externalIntegrationKey", min("spaceId") AS "spaceId"
  FROM "InvStorageLocation"
  WHERE "externalSource" = 'coupang_rocket_growth' AND "isActive" = true AND "externalIntegrationKey" IS NOT NULL
  GROUP BY "externalIntegrationKey"
  HAVING count(DISTINCT "spaceId") = 1
) l
WHERE l."externalIntegrationKey" = w."id";

-- 백필 2순위: 소유자의 가장 오래된 OWNER 멤버십. 이미 다른 Workspace가 차지한 Space는 건너뛰고,
-- 같은 Space를 두 Workspace가 고르면 먼저 만든 Workspace만 연결한다(unique 위반 방지).
UPDATE "Workspace" w
SET "spaceId" = c."spaceId"
FROM (
  SELECT DISTINCT ON (m."spaceId") w2."id" AS "workspaceId", m."spaceId"
  FROM "Workspace" w2
  JOIN LATERAL (
    SELECT sm."spaceId" FROM "SpaceMember" sm
    WHERE sm."userId" = w2."ownerId" AND sm."role" = 'OWNER'
    ORDER BY sm."createdAt" ASC
    LIMIT 1
  ) m ON true
  WHERE w2."spaceId" IS NULL
    AND NOT EXISTS (SELECT 1 FROM "Workspace" w3 WHERE w3."spaceId" = m."spaceId")
  ORDER BY m."spaceId", w2."createdAt" ASC
) c
WHERE w."id" = c."workspaceId";

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_spaceId_key" ON "Workspace"("spaceId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL ON UPDATE CASCADE;
