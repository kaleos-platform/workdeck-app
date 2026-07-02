-- 레이어드 발주 옵션 수요 진실화 — 로켓 레이어 raw GROSS 보관 컬럼.
-- 세트 재-사이징·합산(decompose-sum) 되먹임을 제거하고 옵션 최종수량을 로켓/직접 raw GROSS 합에서
-- 단일차감으로 산출하므로, 로켓 raw GROSS를 직접 GROSS(directGrossQty)와 대칭으로 보관한다.
ALTER TABLE "ReorderPlanItem" ADD COLUMN "rocketGrossQty" DECIMAL(18,4);
