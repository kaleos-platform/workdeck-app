-- 매핑 프리셋에 "주문 총 결제금액" 플래그 추가.
-- 결제금액이 주문 총액(행마다 반복)이면 import 시 동일 주문 그룹의 행을 합산하지 않는다.
-- 기존 프리셋은 default false → 기존 행별 합산 동작 유지(무회귀).
ALTER TABLE "DelColumnMappingPreset" ADD COLUMN "paymentIsOrderTotal" BOOLEAN NOT NULL DEFAULT false;
