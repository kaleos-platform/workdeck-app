-- 채널 자체 배송(연동) 채널 → 대표 채널(통합재고) self-relation 추가.
-- 연동 채널의 판매채널 상품 화면은 대표 채널 상품을 읽기전용으로 미러링한다.
-- nullable 컬럼 추가 + self-FK(ON DELETE SET NULL) + 인덱스. 데이터 손실 없음.

-- AlterTable
ALTER TABLE "Channel" ADD COLUMN "representativeChannelId" TEXT;

-- CreateIndex
CREATE INDEX "Channel_representativeChannelId_idx" ON "Channel"("representativeChannelId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_representativeChannelId_fkey" FOREIGN KEY ("representativeChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
