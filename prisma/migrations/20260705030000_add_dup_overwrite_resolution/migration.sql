-- FinStagedResolution 에 DUP_OVERWRITE 추가 (사용자 "유지" 명시 선택 = 확정 시 분류 덮어쓰기)
ALTER TYPE "FinStagedResolution" ADD VALUE IF NOT EXISTS 'DUP_OVERWRITE';
