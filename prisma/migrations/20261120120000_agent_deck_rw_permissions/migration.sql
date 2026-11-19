-- AlterTable
ALTER TABLE "AgentPendingAction" ADD COLUMN     "notifyError" TEXT;

-- AlterTable
ALTER TABLE "SpaceAgentIdentity" ADD COLUMN     "scopesBackup" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scopesVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "writeGrants" JSONB NOT NULL DEFAULT '{}';


-- 데이터: 권한 정리(2026-11-20). 변환 없이 제거만 한다 — draft:create·slack:write·browser:read·browser:write.
-- 1) 원본을 scopesBackup 에 복사(롤백 근거). 2) 4개 값 제거. 3) 구 초안 자동 실행 기록 비움(롤백 때 구 게이트 재활성 방지).
UPDATE "SpaceAgentIdentity" SET "scopesBackup" = "scopes";

UPDATE "SpaceAgentIdentity"
SET "scopes" = array_remove(array_remove(array_remove(array_remove("scopes",
  'draft:create'), 'slack:write'), 'browser:read'), 'browser:write');

UPDATE "SpaceAgentIdentity"
SET "autoExecuteEnabledById" = NULL, "autoExecuteEnabledAt" = NULL;
