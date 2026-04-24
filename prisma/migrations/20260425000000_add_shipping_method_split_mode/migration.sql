-- 배송 방식별 기본 파일 분할 모드 (주문당 1행 / 옵션당 1행)
ALTER TABLE "DelShippingMethod"
  ADD COLUMN "defaultSplitMode" TEXT NOT NULL DEFAULT 'order';
