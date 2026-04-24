-- ProductListing에 채널별 재고 할당 상한 필드 추가
-- null이면 자동계산 그대로 사용, 값이 있으면 min(할당, 자동계산)으로 가용재고 제한

ALTER TABLE "ProductListing" ADD COLUMN "channelAllocation" INTEGER;
