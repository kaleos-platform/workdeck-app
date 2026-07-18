-- 이벤트 단위 Slack 알림 토글 저장 컬럼.
-- 비활성 이벤트만 { "<eventKey>": false } 로 기록(미기재=on).
ALTER TABLE "DeckInstance" ADD COLUMN "slackNotifyEvents" JSONB;
