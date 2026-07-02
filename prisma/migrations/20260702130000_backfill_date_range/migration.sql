-- CoupangBackfillJob: range 백필(캘린더 특정 구간) 지원.
-- startDate/endDate 가 둘 다 있으면 워커가 days 대신 이 구간을 수집한다.
-- 둘 다 NULL 이면 기존 days 기반(어제부터 역순) 잡. KST YYYY-MM-DD 문자열.
ALTER TABLE "CoupangBackfillJob" ADD COLUMN     "startDate" TEXT;
ALTER TABLE "CoupangBackfillJob" ADD COLUMN     "endDate" TEXT;
