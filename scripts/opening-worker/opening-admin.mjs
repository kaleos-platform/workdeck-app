// 오프닝 운영 DB 관리자 작업(setup.sh 전용). 접속 URL 은 OPENING_ADMIN_URL, 출력은 고정 키·건수만.
//   MODE=grant   읽기 역할 생성/회전 — 기존 권한·멤버십을 모두 지우고 허용 목록만 부여
//   MODE=prefixes 워커가 읽는 파일(target_type 4종)의 storage·첫 경로 조각 목록(IAM 범위 산정)
//   MODE=drop    역할 삭제 후 부재 확인
//   MODE=exists  역할 존재 여부만(API 계정으로도 가능)
//   비밀번호는 stdin 으로 받는다(argv·환경에 남기지 않음).
import fs from 'node:fs'
import pg from 'pg'

const { Client } = pg

const ROLE = 'workdeck_opening_reader'
const TABLES = [
  'address',
  'brand',
  'brand_member',
  'content',
  'detail_template',
  'file',
  'position',
  'posting',
  'posting_position',
  'posting_store',
  'setting',
  'store',
]
const MEMBER_COLUMNS = ['id', 'status', 'email_hash']
// opening-prepare.ts readFile/readAsset 가 허용하는 target_type 과 같다.
const FILE_TYPES = ['posting_detail_img', 'posting_detail', 'content_image', 'content_data']

;(async () => {
  const c = new Client({
    connectionString: process.env.OPENING_ADMIN_URL,
    ssl: { rejectUnauthorized: true, ca: fs.readFileSync(process.env.CA, 'utf8') },
  })
  c.on('error', () => {})
  await c.connect()
  const id = c.escapeIdentifier(ROLE)
  const exists = async () =>
    (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])).rowCount > 0
  // 역할이 소유한 객체(테이블·스키마·함수 등 모든 종류, 클러스터 전체)가 하나라도 있으면 DROP OWNED 가 지워 버리므로 중단한다.
  const assertOwnsNothing = async () => {
    const n = (
      await c.query(
        `SELECT count(*)::int AS n FROM pg_shdepend d JOIN pg_roles r ON r.oid = d.refobjid
       WHERE r.rolname = $1 AND d.deptype = 'o'`,
        [ROLE]
      )
    ).rows[0].n
    if (n) throw Error('ROLE_OWNS_OBJECTS')
  }
  try {
    const mode = process.env.MODE
    if (mode === 'prefixes') {
      const { rows } = await c.query(
        `SELECT storage, split_part(file_key, '/', 1) AS prefix, bool_and(position('/' in file_key) > 0) AS nested, count(*)::int AS n
         FROM file WHERE storage_type = 's3' AND storage IS NOT NULL AND storage <> '' AND target_type = ANY($1)
         GROUP BY 1, 2 ORDER BY 1, 2`,
        [FILE_TYPES]
      )
      process.stdout.write(JSON.stringify(rows))
      return
    }
    if (mode === 'exists') {
      // 어느 계정으로도 pg_roles 는 읽을 수 있다(회수 전 잔존 확인용).
      console.log(JSON.stringify({ role: (await exists()) ? 'present' : 'absent' }))
      return
    }
    if (mode === 'drop') {
      if (await exists()) {
        await c.query('BEGIN')
        // 확인과 삭제를 같은 트랜잭션에서 한다. ponytail: 확인 직후 다른 관리자가 이 역할로 소유권을 넘기는 경쟁은 막지 못한다(전용 역할명이라 실무상 없음).
        await assertOwnsNothing()
        await c.query(`DROP OWNED BY ${id}`)
        await c.query(`DROP ROLE ${id}`)
        await c.query('COMMIT')
      }
      if (await exists()) throw Error('ROLE_STILL_EXISTS')
      console.log(JSON.stringify({ role: 'absent' }))
      return
    }
    if (mode !== 'grant') throw Error('UNKNOWN_MODE')
    const pw = fs.readFileSync(0, 'utf8').trim()
    if (!/^[a-f0-9]{48}$/.test(pw)) throw Error('BAD_PASSWORD_INPUT')
    const db = (await c.query('SELECT current_database() AS d, current_schema() AS s')).rows[0]
    const schema = c.escapeIdentifier(db.s)
    for (const t of [...TABLES, 'member'])
      if (!(await c.query('SELECT to_regclass($1) AS r', [`${db.s}.${t}`])).rows[0].r)
        throw Error(`TABLE_MISSING_${t.toUpperCase()}`)
    // 같은 이름의 기존 역할은 재사용하지 않는다: 소유 객체가 없으면 지우고(DROP OWNED 가 이 DB 의 모든 권한도 회수) 새로 만든다.
    const had = await exists()
    if (had) {
      const dbs = (
        await c.query(
          `SELECT count(*)::int AS n FROM pg_database d WHERE d.datname <> current_database()
           AND NOT d.datistemplate AND has_database_privilege($1, d.oid, 'CONNECT')
           AND d.datname NOT IN ('rdsadmin', 'postgres')`,
          [ROLE]
        )
      ).rows[0].n
      if (dbs) throw Error('ROLE_HAS_OTHER_DATABASE_ACCESS')
    }
    await c.query('BEGIN')
    if (had) {
      await assertOwnsNothing()
      await c.query(`DROP OWNED BY ${id}`)
      await c.query(`DROP ROLE ${id}`)
    }
    await c.query(
      `CREATE ROLE ${id} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3 PASSWORD ${c.escapeLiteral(pw)}`
    )
    await c.query(`ALTER ROLE ${id} SET default_transaction_read_only = on`)
    await c.query(`ALTER ROLE ${id} SET statement_timeout = '120s'`)
    await c.query(`GRANT CONNECT ON DATABASE ${c.escapeIdentifier(db.d)} TO ${id}`)
    await c.query(`GRANT USAGE ON SCHEMA ${schema} TO ${id}`)
    await c.query(
      `GRANT SELECT ON ${TABLES.map((t) => `${schema}.${c.escapeIdentifier(t)}`).join(', ')} TO ${id}`
    )
    // 회원은 대조에 필요한 3개 컬럼만(이름·전화·이메일 암호문·비밀번호는 읽지 못한다)
    await c.query(`GRANT SELECT (${MEMBER_COLUMNS.join(', ')}) ON ${schema}.member TO ${id}`)
    await c.query('COMMIT')
    console.log(
      JSON.stringify({
        role: had ? 'recreated' : 'created',
        tables: TABLES.length,
        memberColumns: MEMBER_COLUMNS.length,
      })
    )
  } finally {
    await c.end()
  }
})().catch((e) => {
  const code = /^[A-Z_0-9]+$/.test(e.message) ? e.message : e.code || 'OPENING_ADMIN_FAILED'
  console.log(JSON.stringify({ status: 'BLOCKED', code }))
  process.exitCode = 1
})
