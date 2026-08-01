-- 글로벌 샘플 템플릿: spaceId nullable (null = 전 워크스페이스 공유), isSample 플래그,
-- sourceRef = 이관 출처 키 (opening detail_template id, 재실행 멱등성)

ALTER TABLE "HiringContent" ALTER COLUMN "spaceId" DROP NOT NULL;

ALTER TABLE "HiringDetailTemplate" ALTER COLUMN "spaceId" DROP NOT NULL;
ALTER TABLE "HiringDetailTemplate" ADD COLUMN "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HiringDetailTemplate" ADD COLUMN "sourceRef" TEXT;

CREATE UNIQUE INDEX "HiringDetailTemplate_sourceRef_key" ON "HiringDetailTemplate"("sourceRef");
