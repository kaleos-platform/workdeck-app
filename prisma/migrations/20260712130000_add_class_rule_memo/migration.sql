-- FinClassRule에 메모 컬럼 추가 (규칙 학습 시 저장, 자동분류 시 스테이징 행으로 복사)
ALTER TABLE "FinClassRule" ADD COLUMN "memo" TEXT;
