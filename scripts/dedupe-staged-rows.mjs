/**
 * 미확정(DRAFT) FinStagedRow 중복 정리 — 같은 (spaceId, accountId, identityKey) 그룹에서
 * 대표 행 1개만 남기고 나머지를 DUP_SAME으로 마킹한다(삭제 아님 — 중복 탭에서 확인 가능).
 * 대표 행 우선순위: 분류완료(CLASSIFIED) > 계정과목 지정 > 먼저 생성된 행.
 *
 * 배경: 업로드 dedup이 확정 거래만 비교해 같은 파일 재업로드 시 큐에 두 벌 쌓이던
 * 버그의 기존 데이터 백필. (commit-staging 라우트 수정과 세트)
 *
 * 사용법:
 *   vercel env pull --environment=production .env.production.local
 *   DATABASE_URL=$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"') \
 *     node scripts/dedupe-staged-rows.mjs --dry      # 사전 조회
 *   DATABASE_URL=... node scripts/dedupe-staged-rows.mjs   # 실제 마킹
 */
import pg from 'pg'

const { Client } = pg
const dryRun = process.argv.includes('--dry')

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다')
  process.exit(1)
}

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

// 대표 행(rn=1)을 제외한 중복 행 — DRAFT 임포트 소속만 대상
const dupSelect = `
  SELECT id, "spaceId", "accountId", "identityKey", "txnDate", amount, description, resolution
  FROM (
    SELECT s.*,
      ROW_NUMBER() OVER (
        PARTITION BY s."spaceId", s."accountId", s."identityKey"
        ORDER BY
          (s."classStatus" = 'CLASSIFIED') DESC,
          (s."categoryId" IS NOT NULL) DESC,
          s."createdAt" ASC,
          s.id ASC
      ) AS rn
    FROM "FinStagedRow" s
    JOIN "FinImport" i ON i.id = s."importId"
    WHERE i.status = 'DRAFT'
  ) t
  WHERE t.rn > 1 AND t.resolution <> 'DUP_SAME'
`

try {
  const { rows: dups } = await client.query(dupSelect)
  console.log(`DUP_SAME 마킹 대상(대표 행 제외 중복): ${dups.length}개`)
  if (dups.length > 0) {
    console.table(
      dups.slice(0, 30).map((r) => ({
        id: r.id,
        identityKey: r.identityKey.slice(0, 40),
        txnDate: r.txnDate?.toISOString?.().slice(0, 10),
        amount: r.amount,
        description: (r.description ?? '').slice(0, 20),
        resolution: r.resolution,
      }))
    )
    if (dups.length > 30) console.log(`... 외 ${dups.length - 30}개`)
  }

  if (dryRun) {
    console.log('\n--dry 모드: 실제 마킹은 수행하지 않았습니다')
    process.exit(0)
  }
  if (dups.length === 0) {
    console.log('정리할 중복이 없습니다')
    process.exit(0)
  }

  const { rowCount } = await client.query(
    `UPDATE "FinStagedRow" SET resolution = 'DUP_SAME' WHERE id = ANY($1::text[])`,
    [dups.map((r) => r.id)]
  )
  console.log(`DUP_SAME 마킹 완료: ${rowCount}행`)
} finally {
  await client.end()
}
