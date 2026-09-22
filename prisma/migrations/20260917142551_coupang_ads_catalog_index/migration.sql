-- 광고유형·최신 날짜 조회가 넓은 기존 인덱스와 원본 행을 읽는 비용을 줄인다.
-- 운영 업로드를 막지 않도록 트랜잭션 밖에서 인덱스를 생성한다.
CREATE INDEX CONCURRENTLY "AdRecord_workspaceId_campaignId_adType_date_idx" ON "AdRecord"("workspaceId", "campaignId", "adType", "date");
