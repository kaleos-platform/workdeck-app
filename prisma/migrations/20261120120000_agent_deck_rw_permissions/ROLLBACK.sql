-- 롤백 절차(수동 실행 — prod DB 에는 운영 승인 후에만). 먼저 코드를 이전 버전으로 되돌린다.
--
-- 1) 배포 후 한 번도 권한을 저장하지 않은 행(scopesVersion = 0)만 백업으로 되돌린다.
UPDATE "SpaceAgentIdentity"
SET "scopes" = "scopesBackup"
WHERE "scopesVersion" = 0 AND cardinality("scopesBackup") > 0;

-- 2) 배포 후 권한이 저장된 행(scopesVersion > 0)은 자동 복원하지 않는다 — 관리자가 바꾼 권한을 덮어쓰지 않기 위해.
--    아래 목록을 검토해 draft:create·browser:* 복원이 필요한 행만 명시적으로 UPDATE 한다.
SELECT "id", "spaceId", "name", "kind", "scopes", "scopesBackup", "scopesVersion"
FROM "SpaceAgentIdentity"
WHERE "scopesVersion" > 0
ORDER BY "spaceId", "name";

-- 컬럼(scopesBackup·writeGrants·scopesVersion·notifyError)은 이전 코드가 무시하므로 DROP 하지 않는다.
-- autoExecuteEnabledById/At 은 비워졌으므로 이전 코드의 draft:create 게이트는 재저장 전까지 열리지 않는다.
