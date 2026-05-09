-- ProductListing의 (channelProductId, searchName) unique 제약 제거.
-- listing 식별은 옵션 구성으로 이루어지며, 이름(searchName/managementName)은 표시용 derived 값.
-- 같은 cp 안에서 동일 이름의 listing이 존재할 수 있다 (예: 가격 정책만 다른 동일 옵션 묶음).

DROP INDEX IF EXISTS "ProductListing_channelProductId_searchName_key";
