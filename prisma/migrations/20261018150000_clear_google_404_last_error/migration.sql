-- Google API 404(잘못된 GA4·GTM 경로 호출)가 자격증명 lastError 로 남아 연동이 '오류'로 보이던 기록 정리.
-- 이 PR 부터 lastError 는 OAuth 실패·401·403 만 기록한다. 데이터만 바꾼다(스키마 변경 없음).
UPDATE "SpaceCredential"
SET "lastError" = NULL
WHERE "provider" = 'google-marketing'
  AND "lastError" LIKE 'Google API 요청 실패 (404)%';
