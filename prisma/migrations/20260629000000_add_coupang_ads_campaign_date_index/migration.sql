-- 쿠팡 광고 캠페인 상세의 기간 집계·페이지네이션 query 최적화.
-- workspace/campaign/date 조건을 한 번에 처리해 불필요한 heap scan을 줄인다.
-- (hand-write: 기존 Supabase storage.buckets migration의 shadow DB P3006 우회)

CREATE INDEX "AdRecord_workspaceId_campaignId_date_idx"
ON "AdRecord"("workspaceId", "campaignId", "date");
