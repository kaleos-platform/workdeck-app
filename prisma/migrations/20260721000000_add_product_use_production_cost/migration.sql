-- 공급원가를 완료 생산 차수 가중평균 단가로 파생 표시할지 여부
ALTER TABLE "InvProduct" ADD COLUMN "useProductionCost" BOOLEAN NOT NULL DEFAULT false;
