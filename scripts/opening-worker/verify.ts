/**
 * 오프닝 자동 이전 워커 접근 확인(run.sh --verify). 쓰기 없음, 출력은 고정 키·건수만.
 * - 워크덱 운영 DB 읽기(job 수)
 * - 오프닝 읽기 계정: 대조 쿼리 가능, 카탈로그 유효 권한(쓰기 0·테이블 12·member 3컬럼·멤버십 0·승격 없음)
 * - S3 전용 키로 원본 파일 1개 읽기
 */
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { openingTlsConfig } from '@/lib/hiring/migration/opening-tls'
import { readS3 } from '@/lib/hiring/migration/opening-run'

// scripts/opening-worker/opening-admin.mjs 의 TABLES 와 같아야 한다.
const ALLOWED_TABLES = [
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

async function main() {
  const out: Record<string, unknown> = {}
  const wd = new Client(
    openingTlsConfig(
      process.env.DIRECT_URL as string,
      readFileSync(process.env.MIGRATION_CA_FILE as string, 'utf8')
    )
  )
  wd.on('error', () => {})
  await wd.connect()
  try {
    await wd.query('BEGIN READ ONLY')
    out.workdeckJobs = (
      await wd.query('SELECT count(*)::int AS n FROM "OpeningMigrationJob"')
    ).rows[0].n
    await wd.query('ROLLBACK')
  } finally {
    await wd.end()
  }

  const op = new Client(
    openingTlsConfig(
      process.env.OPENING_SOURCE_URL as string,
      readFileSync(process.env.OPENING_CA_FILE as string, 'utf8')
    )
  )
  op.on('error', () => {})
  await op.connect()
  let samples: { storage: string; file_key: string }[] = []
  try {
    await op.query('BEGIN')
    out.openingActiveAdmins = (
      await op.query(
        `SELECT count(*)::int AS n FROM brand_member bm JOIN member m ON m.id = bm.member_id
         WHERE bm.member_type = 'admin' AND bm.status = 1 AND m.status = 1 AND m.email_hash IS NOT NULL`
      )
    ).rows[0].n
    // 권한 경계는 오류 여부가 아니라 카탈로그의 유효 권한으로 확인한다(존재하지 않는 컬럼·read-only 기본값에 속지 않게).
    const priv = (
      await op.query(
        `WITH t AS (SELECT c.oid, c.relname, n.nspname = current_schema() AS home FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
                       AND c.relkind IN ('r', 'p', 'v', 'm', 'f'))
         SELECT
           (SELECT count(*)::int FROM t WHERE has_table_privilege(current_user, t.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS writable_tables,
           (SELECT count(*)::int FROM pg_attribute a JOIN t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege(current_user, a.attrelid, a.attnum, 'INSERT,UPDATE,REFERENCES')) AS writable_columns,
           (SELECT array_agg(relname ORDER BY relname) FROM t WHERE home AND has_table_privilege(current_user, t.oid, 'SELECT')) AS readable_tables,
           (SELECT array_agg(DISTINCT (CASE WHEN t.home THEN '' ELSE '~' END) || t.relname || '.' || a.attname)
              FROM pg_attribute a JOIN t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped
                AND has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) AS readable_columns,
           (SELECT count(*)::int FROM t WHERE NOT home AND has_table_privilege(current_user, t.oid, 'SELECT')) AS readable_elsewhere,
           (SELECT count(*)::int FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(current_user, n.oid, 'CREATE')) AS create_schemas,
           (SELECT array_agg(a.attname ORDER BY a.attname) FROM pg_attribute a JOIN t ON t.oid = a.attrelid
             WHERE t.home AND t.relname = 'member' AND a.attnum > 0 AND NOT a.attisdropped
               AND has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) AS member_columns,
           (SELECT count(*)::int FROM pg_attribute a JOIN t ON t.oid = a.attrelid
             WHERE t.home AND t.relname = 'member' AND a.attnum > 0 AND NOT a.attisdropped) AS member_total_columns,
           (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = current_user) AS memberships,
           (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS elevated`
      )
    ).rows[0]
    out.writableTables = priv.writable_tables
    out.writableColumns = priv.writable_columns
    out.readableTables = (priv.readable_tables ?? []).length
    // 허용 목록 밖에서 읽을 수 있는 컬럼(다른 스키마는 ~ 접두사). PUBLIC 의 컬럼 단위 권한까지 잡는다.
    out.unexpectedReadableColumns = ((priv.readable_columns ?? []) as string[]).filter((tc) => {
      const [table, column] = tc.split('.')
      if (table === 'member') return !['id', 'status', 'email_hash'].includes(column)
      return !ALLOWED_TABLES.includes(table)
    }).length
    out.readableTableNamesOk =
      ((priv.readable_tables ?? []) as string[]).join(',') === [...ALLOWED_TABLES].sort().join(',')
    out.readableElsewhere = priv.readable_elsewhere
    // 어떤 스키마에도 객체를 만들 수 없어야 한다(PUBLIC 상속 포함). read-only 기본값은 세션에서 바꿀 수 있어 경계가 아니다.
    out.createSchemas = priv.create_schemas
    out.memberColumns = priv.member_columns ?? []
    out.memberTotalColumns = priv.member_total_columns
    out.memberships = priv.memberships
    out.elevated = priv.elevated
    out.readOnlyDefault = (
      await op.query('SHOW transaction_read_only')
    ).rows[0].transaction_read_only
    samples = (
      await op.query(
        `SELECT DISTINCT ON (storage, split_part(file_key, '/', 1)) storage, file_key FROM file
         WHERE status = 1 AND storage_type = 's3' AND storage IS NOT NULL AND storage <> ''
           AND target_type IN ('posting_detail_img', 'posting_detail', 'content_image', 'content_data')
         ORDER BY storage, split_part(file_key, '/', 1), id DESC LIMIT 30`
      )
    ).rows
    await op.query('ROLLBACK')
  } finally {
    await op.end()
  }

  // 워커가 읽는 파일 종류의 prefix 마다 1개씩 읽어 IAM 범위가 충분한지 확인한다.
  let s3Ok = 0
  for (const sample of samples)
    if ((await readS3({ bucket: sample.storage, key: sample.file_key })).byteLength > 0) s3Ok++
  out.s3Prefixes = samples.length
  out.s3Readable = s3Ok
  const memberColumns = out.memberColumns as string[]
  const ok =
    out.writableTables === 0 &&
    out.writableColumns === 0 &&
    out.readableTables === 12 &&
    out.readableTableNamesOk === true &&
    out.unexpectedReadableColumns === 0 &&
    out.readableElsewhere === 0 &&
    out.createSchemas === 0 &&
    memberColumns.join(',') === 'email_hash,id,status' &&
    Number(out.memberTotalColumns) > 3 &&
    out.memberships === 0 &&
    out.elevated === false &&
    out.readOnlyDefault === 'on' &&
    samples.length > 0 &&
    s3Ok === samples.length
  console.log(JSON.stringify({ status: ok ? 'VERIFIED' : 'CHECK_FAILED', ...out }))
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : ''
  console.log(
    JSON.stringify({
      status: 'BLOCKED',
      code: /^[A-Z_0-9]+$/.test(message) ? message : 'VERIFY_FAILED',
    })
  )
  process.exitCode = 1
})
