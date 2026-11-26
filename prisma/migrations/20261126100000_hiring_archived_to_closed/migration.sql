-- 보관(ARCHIVED) 상태 폐지: 기존 행을 마감(CLOSED)으로 변환한다. enum 값은 구 코드 호환을 위해 남긴다.
UPDATE "HiringPosting" SET "status" = 'CLOSED', "updatedAt" = now() WHERE "status" = 'ARCHIVED';
