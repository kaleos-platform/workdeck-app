-- 의식주의 미닝랩 수동 채널: 네이버에 아직 게시하지 않은 2건을 게시 대기로 되돌린다(사용자 확인 2026-11-01).
UPDATE "ContentDeployment"
SET "status" = 'AWAITING_MANUAL', "publishedAt" = NULL, "updatedAt" = NOW()
WHERE "id" IN ('cmvur1b7e000a08jxkdjn18b7', 'cmvwghui3000408icfikl0ofd')
  AND "status" = 'PUBLISHED'
  AND "platformUrl" IS NULL;
