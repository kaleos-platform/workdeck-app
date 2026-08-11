#!/usr/bin/env node
// 운영자(OPERATOR) 지정 도구 (CLI). DATABASE_URL 환경변수 필요 — prod는 `vercel env pull` 후 실행.
// 운영자 지정은 어드민 UI에 만들지 않는다(권한 상승 표면 최소화) — 이 스크립트로만 부여/회수.
//
// 사용법:
//   node scripts/grant-operator.mjs grant <email>    # 운영자 부여
//   node scripts/grant-operator.mjs revoke <email>   # 운영자 회수
//   node scripts/grant-operator.mjs list             # 현재 운영자 목록
import 'dotenv/config'
import { config } from 'dotenv'
import pg from 'pg'

config({ path: '.env.local', override: false })

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL 또는 DIRECT_URL 환경변수가 필요합니다')
  process.exit(1)
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})

const [cmd, ...args] = process.argv.slice(2)

async function main() {
  await client.connect()

  switch (cmd) {
    case 'grant': {
      const [email] = args
      if (!email) throw new Error('email이 필요합니다')
      const r = await client.query(
        `UPDATE "User" SET "platformRole" = 'OPERATOR'::"PlatformRole" WHERE email = $1
         RETURNING id, email`,
        [email]
      )
      if (r.rowCount === 0) throw new Error(`사용자 ${email} 없음`)
      console.log(`✔ ${email} (${r.rows[0].id}) → OPERATOR 부여`)
      break
    }

    case 'revoke': {
      const [email] = args
      if (!email) throw new Error('email이 필요합니다')
      const r = await client.query(
        `UPDATE "User" SET "platformRole" = NULL WHERE email = $1
         RETURNING id, email`,
        [email]
      )
      if (r.rowCount === 0) throw new Error(`사용자 ${email} 없음`)
      console.log(`✔ ${email} (${r.rows[0].id}) → OPERATOR 회수`)
      break
    }

    case 'list': {
      const r = await client.query(
        `SELECT id, email, name, "createdAt" FROM "User" WHERE "platformRole" = 'OPERATOR'::"PlatformRole"
         ORDER BY "createdAt" ASC`
      )
      console.log('\n── 운영자 목록 ──')
      console.table(r.rows)
      break
    }

    default:
      console.error('알 수 없는 명령. grant|revoke|list')
      process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
  .finally(() => client.end())
