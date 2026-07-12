-- HiringPosting에 템플릿 스냅샷 메타 컬럼 추가 (덮어쓰기 대상 id + 저장/적용 시각)
ALTER TABLE "HiringPosting" ADD COLUMN "appliedTemplateId" TEXT;
ALTER TABLE "HiringPosting" ADD COLUMN "appliedTemplateAt" TIMESTAMP(3);
