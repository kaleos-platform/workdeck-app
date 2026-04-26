-- 관리 상품명(internalName) 필드 추가
-- name(공식 상품명)은 그대로 유지, internalName은 optional
ALTER TABLE "InvProduct" ADD COLUMN "internalName" TEXT;

-- 검색 UX 유지를 위해 기존 상품은 현재 name 값을 initial internalName으로 백필
-- (사용자가 명시적으로 비우면 NULL이 되어 표시 시 name으로 fallback)
UPDATE "InvProduct" SET "internalName" = "name" WHERE "internalName" IS NULL;
