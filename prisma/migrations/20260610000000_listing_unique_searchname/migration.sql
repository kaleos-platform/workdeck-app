-- ProductListing의 unique scope을 (channelProductId, managementName) → (channelProductId, searchName)으로 변경.
-- 이유: base 변경 시 모든 listing의 managementName이 동일하게 업데이트될 수 있어 P2002 충돌이 발생함.
-- searchName은 자동 suffix 로직 덕에 listing마다 항상 다르므로 listing 식별에 더 적합한 키.

DROP INDEX IF EXISTS "ProductListing_channelProductId_managementName_key";

CREATE UNIQUE INDEX "ProductListing_channelProductId_searchName_key"
  ON "ProductListing"("channelProductId", "searchName");
