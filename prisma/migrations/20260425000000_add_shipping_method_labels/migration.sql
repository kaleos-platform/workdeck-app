-- Phase B: 배송 방식 × 옵션별 필드 오버라이드 테이블
CREATE TABLE "DelShippingMethodLabel" (
  "id"               TEXT NOT NULL,
  "spaceId"          TEXT NOT NULL,
  "shippingMethodId" TEXT NOT NULL,
  "optionId"         TEXT NOT NULL,
  "overrides"        JSONB NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DelShippingMethodLabel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DelShippingMethodLabel_shippingMethodId_optionId_key"
  ON "DelShippingMethodLabel"("shippingMethodId", "optionId");
CREATE INDEX "DelShippingMethodLabel_spaceId_idx"   ON "DelShippingMethodLabel"("spaceId");
CREATE INDEX "DelShippingMethodLabel_optionId_idx"  ON "DelShippingMethodLabel"("optionId");

ALTER TABLE "DelShippingMethodLabel"
  ADD CONSTRAINT "DelShippingMethodLabel_spaceId_fkey"
  FOREIGN KEY ("spaceId") REFERENCES "Space"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DelShippingMethodLabel"
  ADD CONSTRAINT "DelShippingMethodLabel_shippingMethodId_fkey"
  FOREIGN KEY ("shippingMethodId") REFERENCES "DelShippingMethod"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DelShippingMethodLabel"
  ADD CONSTRAINT "DelShippingMethodLabel_optionId_fkey"
  FOREIGN KEY ("optionId") REFERENCES "InvProductOption"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
