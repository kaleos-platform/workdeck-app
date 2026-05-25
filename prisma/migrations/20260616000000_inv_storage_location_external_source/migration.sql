-- AlterTable: 보관 장소에 외부 데이터 소스 자동 매핑 필드 추가
ALTER TABLE "InvStorageLocation"
  ADD COLUMN "externalSource" TEXT,
  ADD COLUMN "externalIntegrationKey" TEXT;

-- CreateIndex: space 내 externalSource 유일성 (NULL 다중 허용)
CREATE UNIQUE INDEX "InvStorageLocation_spaceId_externalSource_key"
  ON "InvStorageLocation"("spaceId", "externalSource");
