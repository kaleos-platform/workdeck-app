-- Relax ChannelProductAlias target requirement.
-- Manual fulfillment 매칭은 listingId·optionId 모두 null + ChannelProductAliasFulfillment 자식 테이블에 (옵션, 수량) 행을 가진다.
-- 기존 CHECK constraint("optionId IS NOT NULL OR listingId IS NOT NULL")는 manual 매칭 시 위반됨.
-- Postgres CHECK는 다른 테이블 참조(EXISTS) 불가하므로 제약을 단순 DROP한다.
-- 빈 alias(자식 테이블 0행) 방지는 애플리케이션 레이어에서 처리.

ALTER TABLE "ChannelProductAlias" DROP CONSTRAINT IF EXISTS "ChannelProductAlias_target_required_check";
