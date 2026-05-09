-- 운영 DB에 남아있는 옛 unique 인덱스 정리.
-- 20260609000000_drop_channelproduct_productid 마이그레이션이 `DROP CONSTRAINT IF EXISTS`로 처리했지만,
-- 실제 운영 DB에서는 CONSTRAINT가 아닌 INDEX로만 등록되어 있어 효과가 없었음.
-- 결과: ProductListing PATCH 시 P2002 (channelId, managementName) 충돌 발생.
-- listing 식별은 옵션 구성 기반이며 이름은 표시용이므로 unique 불필요.

DROP INDEX IF EXISTS "ProductListing_channelId_managementName_key";
