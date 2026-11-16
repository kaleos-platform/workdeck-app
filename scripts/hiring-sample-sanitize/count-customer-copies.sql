-- 샘플 템플릿(opening 이관 29개)에서 고객 공간으로 퍼진 복사본 집계 — 읽기 전용(SELECT 만).
-- 결과는 건수만 출력한다(공고 제목·지원자 등 고객 데이터 본문은 출력하지 않음).
-- 한계: 고객이 다시 저장해 경로·텍스트가 바뀐 블록은 추적 불가 → 아래 합집합이 '최소 영향'.

-- 1) 마지막으로 샘플을 적용한 공고(appliedTemplateId 는 마지막 적용 스냅샷이라 하한값) — 상태별
SELECT p.status, count(*) AS postings, count(DISTINCT p."spaceId") AS spaces
FROM "HiringPosting" p
JOIN "HiringDetailTemplate" t ON t.id = p."appliedTemplateId"
WHERE t."spaceId" IS NULL AND t."isSample" AND t."sourceRef" LIKE 'opening:detail_template:%'
GROUP BY p.status ORDER BY p.status;

-- 2) 고객 소유 블록 중 샘플 저장 객체(samples/...)를 그대로 쓰는 것 — 출처·공고 상태별
SELECT c."sourceType", coalesce(p.status::text, '(템플릿)') AS posting_status,
       count(*) AS blocks, count(DISTINCT c."spaceId") AS spaces
FROM "HiringContent" c
LEFT JOIN "HiringPosting" p ON p.id = c."postingId"
WHERE c."spaceId" IS NOT NULL AND c."imagePath" LIKE 'samples/%'
GROUP BY 1, 2 ORDER BY 1, 2;

-- 3) 고객 소유 블록 중 scene 텍스트에 브랜드·연락처가 남은 것(경로가 바뀐 블록 포함) — 출처·공고 상태별
SELECT c."sourceType", coalesce(p.status::text, '(템플릿)') AS posting_status,
       count(*) AS blocks, count(DISTINCT c."spaceId") AS spaces
FROM "HiringContent" c
LEFT JOIN "HiringPosting" p ON p.id = c."postingId"
WHERE c."spaceId" IS NOT NULL
  AND c.data::text ~* '오프닝|opening ?work|opening@|opening\.co\.kr|recruit\.com|피크|peakdining|오픈샐러드'
GROUP BY 1, 2 ORDER BY 1, 2;

-- 4) 고객 공간 템플릿 중 커버가 샘플 객체인 것
SELECT count(*) AS templates, count(DISTINCT "spaceId") AS spaces
FROM "HiringDetailTemplate"
WHERE "spaceId" IS NOT NULL AND "imagePath" LIKE 'samples/%';
