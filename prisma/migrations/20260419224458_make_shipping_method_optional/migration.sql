-- 배송 방식 없이도 배송 등록이 가능하도록 DelOrder.shippingMethodId 를 nullable 로 변경
-- 배송 파일 생성·처리 완료 시점에만 배송 방식이 요구됨

-- DropForeignKey
ALTER TABLE "DelOrder" DROP CONSTRAINT "DelOrder_shippingMethodId_fkey";

-- AlterTable
ALTER TABLE "DelOrder" ALTER COLUMN "shippingMethodId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "DelOrder" ADD CONSTRAINT "DelOrder_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "DelShippingMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
