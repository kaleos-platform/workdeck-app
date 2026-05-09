/**
 * 운영 DB의 ProductListing 인덱스/제약 + _prisma_migrations 상태 진단.
 *
 * 사용법:
 *   vercel env pull --environment=production .env.production.local
 *   DATABASE_URL=$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"') \
 *     node scripts/diagnose-listing-unique.mjs
 */
import pg from 'pg'

const { Client } = pg

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL 환경변수가 필요합니다')
  process.exit(1)
}

const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  console.log('=== ProductListing 인덱스/제약 ===')
  const { rows: indexes } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'ProductListing'
    ORDER BY indexname
  `)
  console.table(indexes)

  console.log('\n=== _prisma_migrations 최근 10건 ===')
  const { rows: migrations } = await client.query(`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 10
  `)
  console.table(migrations)

  console.log('\n=== 관련 마이그레이션 적용 여부 ===')
  const targets = [
    '20260608000000_fix_listing_unique_managementname',
    '20260609000000_drop_channelproduct_productid',
    '20260610000000_listing_unique_searchname',
    '20260611000000_drop_listing_unique',
  ]
  const { rows: applied } = await client.query(
    `SELECT migration_name, finished_at, rolled_back_at
       FROM "_prisma_migrations"
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name`,
    [targets]
  )
  console.table(applied)
  const appliedNames = new Set(
    applied.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name)
  )
  for (const name of targets) {
    console.log(`${appliedNames.has(name) ? '✅' : '❌'} ${name}`)
  }
} finally {
  await client.end()
}
