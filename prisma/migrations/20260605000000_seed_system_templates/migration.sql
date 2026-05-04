-- Idempotent seed for system Template rows.
--
-- 컨텍스트: prisma/seed.ts 는 로컬 dev 전용. prisma migrate deploy 는 스키마만 적용하고
-- seed 를 실행하지 않으므로, 운영(prod) Template 테이블에 시스템 템플릿이 누락된다.
-- 도메인 재설계 PR #29 에서 slug 컬럼 + unique constraint 가 제거됐으므로
-- WHERE NOT EXISTS (spaceId IS NULL AND isSystem = true AND name = ?) 패턴으로 멱등성 확보.
--
-- 정책: 정적 시드는 data-only 마이그레이션으로 분리한다
-- (선례: 20260513000000_seed_sales_content_deckapp).
--
-- 영향 범위: Template 테이블의 시스템 템플릿 3행. 사용자 템플릿(spaceId IS NOT NULL) 은 건드리지 않는다.
--
-- 멱등성: WHERE NOT EXISTS (spaceId IS NULL AND isSystem AND name = ?) 로 재실행 안전.
-- slug unique constraint 없으므로 ON CONFLICT 사용 불가 → SELECT 가드 패턴 사용.

-- ─── 1. 블로그 장문 (BLOG) ────────────────────────────────────────────────────
INSERT INTO "Template" (id, "spaceId", name, kind, sections, "isSystem", "isActive", "createdAt", "updatedAt")
SELECT
  'tmpl_system_blog_long',
  NULL,
  '블로그 장문',
  'BLOG',
  '{
    "sections": [
      {"key": "title",        "kind": "text",      "label": "제목",        "constraints": {"maxLength": 80, "required": true}},
      {"key": "lead",         "kind": "text",      "label": "도입 (훅)",   "guidance": "독자의 문제를 한 문장으로 선언"},
      {"key": "h2_problem",   "kind": "text",      "label": "H2 — 문제 제기"},
      {"key": "body_problem", "kind": "text",      "label": "문제 본문"},
      {"key": "image1",       "kind": "imageSlot", "label": "대표 이미지", "constraints": {"aspectRatio": "16:9"}},
      {"key": "h2_solution",  "kind": "text",      "label": "H2 — 해결책"},
      {"key": "body_solution","kind": "text",      "label": "해결책 본문"},
      {"key": "h2_proof",     "kind": "text",      "label": "H2 — 증빙/사례"},
      {"key": "body_proof",   "kind": "text",      "label": "증빙 본문"},
      {"key": "cta",          "kind": "cta",       "label": "행동 유도"}
    ]
  }'::jsonb,
  true,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Template"
  WHERE "spaceId" IS NULL
    AND "isSystem" = true
    AND name = '블로그 장문'
);

-- ─── 2. 소셜 텍스트 (SOCIAL) ─────────────────────────────────────────────────
INSERT INTO "Template" (id, "spaceId", name, kind, sections, "isSystem", "isActive", "createdAt", "updatedAt")
SELECT
  'tmpl_system_social_text',
  NULL,
  '소셜 텍스트',
  'SOCIAL',
  '{
    "sections": [
      {"key": "hook",  "kind": "text",      "label": "훅 (1-2문장)", "constraints": {"maxLength": 200, "required": true}},
      {"key": "body",  "kind": "text",      "label": "본문",         "constraints": {"maxLength": 500}},
      {"key": "image", "kind": "imageSlot", "label": "이미지",       "constraints": {"aspectRatio": "1:1"}},
      {"key": "cta",   "kind": "cta",       "label": "행동 유도"}
    ]
  }'::jsonb,
  true,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Template"
  WHERE "spaceId" IS NULL
    AND "isSystem" = true
    AND name = '소셜 텍스트'
);

-- ─── 3. 카드뉴스 (5장) (CARDNEWS) ────────────────────────────────────────────
-- 슬라이드 구성: index 0 (표지), index 1~3 (카피+이미지), index 4 (요약+CTA)
-- template-engine.ts 의 [1,2,3].map<TemplateSlide> 결과를 펼쳐서 기술.
INSERT INTO "Template" (id, "spaceId", name, kind, sections, "isSystem", "isActive", "createdAt", "updatedAt")
SELECT
  'tmpl_system_cardnews_5',
  NULL,
  '카드뉴스 (5장)',
  'CARDNEWS',
  '{
    "slides": [
      {
        "index": 0,
        "sections": [
          {"key": "title", "kind": "text",      "label": "표지 제목", "constraints": {"required": true}},
          {"key": "image", "kind": "imageSlot", "label": "표지 이미지", "constraints": {"aspectRatio": "1:1"}}
        ]
      },
      {
        "index": 1,
        "sections": [
          {"key": "caption", "kind": "text",      "label": "카피 1", "constraints": {"maxLength": 120}},
          {"key": "image",   "kind": "imageSlot", "label": "이미지 1", "constraints": {"aspectRatio": "1:1"}}
        ]
      },
      {
        "index": 2,
        "sections": [
          {"key": "caption", "kind": "text",      "label": "카피 2", "constraints": {"maxLength": 120}},
          {"key": "image",   "kind": "imageSlot", "label": "이미지 2", "constraints": {"aspectRatio": "1:1"}}
        ]
      },
      {
        "index": 3,
        "sections": [
          {"key": "caption", "kind": "text",      "label": "카피 3", "constraints": {"maxLength": 120}},
          {"key": "image",   "kind": "imageSlot", "label": "이미지 3", "constraints": {"aspectRatio": "1:1"}}
        ]
      },
      {
        "index": 4,
        "sections": [
          {"key": "summary", "kind": "text", "label": "요약"},
          {"key": "cta",     "kind": "cta",  "label": "행동 유도"}
        ]
      }
    ]
  }'::jsonb,
  true,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "Template"
  WHERE "spaceId" IS NULL
    AND "isSystem" = true
    AND name = '카드뉴스 (5장)'
);
