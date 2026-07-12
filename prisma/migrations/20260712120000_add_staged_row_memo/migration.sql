-- FinStagedRow에 사용자 메모 컬럼 추가 (저장 처리 시 확정 거래로 이관)
ALTER TABLE "FinStagedRow" ADD COLUMN "memo" TEXT;
