-- DelShippingMethod.locationId — 배송 방식별 출고 재고 위치 (예: 3PL)
ALTER TABLE "DelShippingMethod" ADD COLUMN "locationId" TEXT;

ALTER TABLE "DelShippingMethod" ADD CONSTRAINT "DelShippingMethod_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InvStorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DelShippingMethod_locationId_idx" ON "DelShippingMethod"("locationId");
