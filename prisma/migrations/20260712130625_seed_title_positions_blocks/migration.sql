-- 데이터 전용 마이그레이션 (스키마 변경 없음)
-- 기존 공고(HiringPosting)에 대해 제목 텍스트 블록(sortOrder 0)과
-- 직무 정보 블록(sortOrder 1, 직무가 있는 공고만)을 HiringContent 에 시드하고,
-- 기존 POSTING_DETAIL 블록들은 sortOrder 를 +2 시프트한다.

-- 1) 기존 POSTING_DETAIL 콘텐츠 sortOrder +2 시프트
UPDATE "HiringContent"
SET "sortOrder" = "sortOrder" + 2
WHERE "sourceType" = 'POSTING_DETAIL';

-- 2) 모든 공고에 제목 텍스트 블록(sortOrder 0) 삽입
INSERT INTO "HiringContent" (
  "id", "spaceId", "sourceType", "postingId", "contentType", "data", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."spaceId",
  'POSTING_DETAIL',
  p."id",
  'text',
  jsonb_build_object(
    'type', 'doc',
    'content', CASE
      WHEN p."title" IS NOT NULL AND btrim(p."title") <> '' THEN
        jsonb_build_array(
          jsonb_build_object(
            'type', 'heading',
            'attrs', jsonb_build_object('level', 2),
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', p."title")
            )
          )
        )
      ELSE '[]'::jsonb
    END
  ),
  0,
  now(),
  now()
FROM "HiringPosting" p;

-- 3) 직무가 1개 이상 있는 공고에만 직무 정보 블록(sortOrder 1) 삽입
INSERT INTO "HiringContent" (
  "id", "spaceId", "sourceType", "postingId", "contentType", "data", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."spaceId",
  'POSTING_DETAIL',
  p."id",
  'positions',
  NULL,
  1,
  now(),
  now()
FROM "HiringPosting" p
WHERE EXISTS (
  SELECT 1 FROM "HiringPostingPosition" pp WHERE pp."postingId" = p."id"
);
