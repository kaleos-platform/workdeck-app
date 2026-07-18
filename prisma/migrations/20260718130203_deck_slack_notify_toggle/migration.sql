-- Deck 단위 Slack 알림 토글 컬럼 추가
ALTER TABLE "DeckInstance" ADD COLUMN "slackNotifyEnabled" BOOLEAN NOT NULL DEFAULT true;
