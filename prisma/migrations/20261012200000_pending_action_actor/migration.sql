-- 승인 큐 행위자·요청자·workId. DB 컬럼 "requestedBy"는 rename하지 않는다(배포 중 구버전 함수 호환,
-- Prisma 필드 이름만 actorId). actorType 기본값 'legacy' = actorType 없이 INSERT한 구버전 함수의 행.

-- AlterTable
ALTER TABLE "AgentPendingAction" ADD COLUMN     "actorType" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN     "requesterSlackUserId" TEXT,
ADD COLUMN     "requesterUserId" TEXT,
ADD COLUMN     "workId" TEXT;

-- 백필(legacy 행만): 사람(User)이 MCP·웹으로 직접 만든 행만 user(요청자 = 행위자).
-- 'worker'와 내장 에이전트(OWNER로 대신 기록)는 system. 같은 문장을 Step 6b 후속 마이그레이션이 다시 실행한다.
UPDATE "AgentPendingAction" a
SET "actorType" = CASE WHEN a."source" IN ('MCP', 'WEB') AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = a."requestedBy")
                       THEN 'user' ELSE 'system' END,
    "requesterUserId" = CASE WHEN a."source" IN ('MCP', 'WEB') AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = a."requestedBy")
                       THEN a."requestedBy" ELSE a."requesterUserId" END
WHERE a."actorType" = 'legacy';

-- CreateIndex
CREATE INDEX "AgentPendingAction_workId_idx" ON "AgentPendingAction"("workId");
