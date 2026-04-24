-- Space별 옵션 값-코드 자동 학습 사전
-- (spaceId, attributeName, value) → code. 사용자가 값-코드를 수정해 저장할 때 upsert.
CREATE TABLE "SpaceOptionCodeAlias" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "attributeName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpaceOptionCodeAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpaceOptionCodeAlias_spaceId_attributeName_value_key" ON "SpaceOptionCodeAlias"("spaceId", "attributeName", "value");

CREATE INDEX "SpaceOptionCodeAlias_spaceId_idx" ON "SpaceOptionCodeAlias"("spaceId");

ALTER TABLE "SpaceOptionCodeAlias" ADD CONSTRAINT "SpaceOptionCodeAlias_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
