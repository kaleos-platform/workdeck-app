-- 한 Slack team을 여러 Space가 공유한다: teamId 고유 제약 → 일반 인덱스.
-- 데이터 변경 없음. 기존 설치 행(의식주의)은 그대로 유효하다.
DROP INDEX "SlackInstallation_teamId_key";
CREATE INDEX "SlackInstallation_teamId_idx" ON "SlackInstallation"("teamId");
