-- AdRecord 14일 전환 지표 (KEYWORD 포맷 소스에만 존재, NCA·기존 데이터는 NULL)
ALTER TABLE "AdRecord" ADD COLUMN "orders14d" INTEGER;
ALTER TABLE "AdRecord" ADD COLUMN "revenue14d" DECIMAL(18,2);
ALTER TABLE "AdRecord" ADD COLUMN "roas14d" DECIMAL(10,4);
