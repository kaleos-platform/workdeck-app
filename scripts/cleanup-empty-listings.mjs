/**
 * 옵션(items)이 없는 ProductListing 및 빈 ChannelProduct(listings 0개)를 정리하는 스크립트.
 *
 * 사용법:
 *   vercel env pull --environment=production .env.production.local
 *   DATABASE_URL=$(grep '^DATABASE_URL=' .env.production.local | cut -d= -f2- | tr -d '"') \
 *     node scripts/cleanup-empty-listings.mjs --dry      # 사전 조회
 *   DATABASE_URL=... node scripts/cleanup-empty-listings.mjs   # 실제 삭제
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

try {
  // 1) 옵션 없는 ProductListing
  const { rows: emptyListings } = await client.query(`
    SELECT l.id, l."searchName", l."channelId", l."channelProductId", l."status"
    FROM "ProductListing" l
    LEFT JOIN "ProductListingItem" i ON i."listingId" = l.id
    WHERE i.id IS NULL
    ORDER BY l."createdAt"
  `)
  console.log(`옵션 없는 ProductListing: ${emptyListings.length}개`)
  if (emptyListings.length > 0) {
    console.table(emptyListings.slice(0, 30))
    if (emptyListings.length > 30) console.log(`... 외 ${emptyListings.length - 30}개`)
  }

  // 2) listings가 0개인 빈 ChannelProduct (현재 시점 기준 — 1단계 삭제 전이라도 이미 비어있는 케이스)
  const { rows: emptyCpsPreview } = await client.query(`
    SELECT cp.id, cp."baseSearchName", cp."baseManagementName"
    FROM "ChannelProduct" cp
    LEFT JOIN "ProductListing" l ON l."channelProductId" = cp.id
    GROUP BY cp.id
    HAVING COUNT(l.id) = 0
    ORDER BY cp."baseSearchName"
  `)
  console.log(`\n빈 ChannelProduct: ${emptyCpsPreview.length}개`)
  if (emptyCpsPreview.length > 0) {
    console.table(emptyCpsPreview.slice(0, 30))
    if (emptyCpsPreview.length > 30) console.log(`... 외 ${emptyCpsPreview.length - 30}개`)
  }

  if (dryRun) {
    console.log('\n--dry 모드: 실제 삭제는 수행하지 않았습니다')
    process.exit(0)
  }

  if (emptyListings.length === 0 && emptyCpsPreview.length === 0) {
    console.log('정리할 데이터가 없습니다')
    process.exit(0)
  }

  await client.query('BEGIN')

  let delListing = { rowCount: 0 }
  if (emptyListings.length > 0) {
    delListing = await client.query(`DELETE FROM "ProductListing" WHERE id = ANY($1)`, [
      emptyListings.map((r) => r.id),
    ])
  }

  // listing 삭제 후 다시 조회 (1단계로 인해 새로 비게 된 cp 포함)
  const { rows: emptyCps } = await client.query(`
    SELECT cp.id
    FROM "ChannelProduct" cp
    LEFT JOIN "ProductListing" l ON l."channelProductId" = cp.id
    GROUP BY cp.id
    HAVING COUNT(l.id) = 0
  `)
  let delCp = { rowCount: 0 }
  if (emptyCps.length > 0) {
    delCp = await client.query(`DELETE FROM "ChannelProduct" WHERE id = ANY($1)`, [
      emptyCps.map((r) => r.id),
    ])
  }

  await client.query('COMMIT')
  console.log(
    `\n삭제 완료: ProductListing ${delListing.rowCount}개, ChannelProduct ${delCp.rowCount}개`
  )
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('실패:', e)
  process.exit(1)
} finally {
  await client.end()
}
