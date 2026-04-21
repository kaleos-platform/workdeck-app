// 사용: node scripts/confirm-qa-user.mjs <email>
// auth.users.email_confirmed_at을 NOW()로 채워 즉시 로그인 가능한 상태로 만듭니다.
import pg from 'pg'

const email = process.argv[2]
if (!email) {
  console.error('email arg required')
  process.exit(2)
}

const conn = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!conn) {
  console.error('DATABASE_URL missing')
  process.exit(2)
}

const client = new pg.Client({ connectionString: conn })
await client.connect()
const r = await client.query(
  `UPDATE auth.users SET email_confirmed_at=NOW() WHERE email=$1 RETURNING id`,
  [email]
)
console.log(JSON.stringify({ updated: r.rowCount, rows: r.rows }))
await client.end()
