-- 모집 관리(recruiting) DeckApp 추가 + 기존 두 채용 deck 비활성화 (데이터 전용 마이그레이션)

-- 1. recruiting DeckApp upsert
INSERT INTO "DeckApp" ("id", "name", "description", "isActive")
VALUES (
  'recruiting',
  '모집 관리',
  '채용 공고 제작·발행·지원자 관리·블랙리스트·알림',
  true
)
ON CONFLICT ("id") DO UPDATE
  SET "name" = EXCLUDED."name",
      "description" = EXCLUDED."description",
      "isActive" = EXCLUDED."isActive";

-- 2. 기존 두 deck에 DeckInstance가 있는 spaceId마다 recruiting DeckInstance 생성
INSERT INTO "DeckInstance" ("id", "spaceId", "deckAppId", "isActive", "createdAt")
SELECT
  gen_random_uuid()::text,
  "spaceId",
  'recruiting',
  true,
  NOW()
FROM (
  SELECT DISTINCT "spaceId"
  FROM "DeckInstance"
  WHERE "deckAppId" IN ('hiring-posts', 'hiring-applicants')
) AS existing_spaces
ON CONFLICT ("spaceId", "deckAppId") DO NOTHING;

-- 3. 기존 두 채용 deck 비활성화
UPDATE "DeckApp"
SET "isActive" = false
WHERE "id" IN ('hiring-posts', 'hiring-applicants');
