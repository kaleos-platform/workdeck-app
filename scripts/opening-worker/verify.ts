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
  // 워커(connectOpening)와 같은 세션 설정: 기본 트랜잭션을 읽기 전용으로 연다.
  await op.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
  const apiAccount = process.env.OPENING_READER_KIND === 'api'
  out.readerKind = apiAccount ? 'api' : 'role'
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
           (SELECT array_agg(relname::text ORDER BY relname) FROM t WHERE home AND has_table_privilege(current_user, t.oid, 'SELECT')) AS readable_tables,
           (SELECT array_agg(DISTINCT (CASE WHEN t.home THEN '' ELSE '~' END) || t.relname || '.' || a.attname)
              FROM pg_attribute a JOIN t ON t.oid = a.attrelid WHERE a.attnum > 0 AND NOT a.attisdropped
                AND has_column_privilege(current_user, a.attrelid, a.attnum, 'SELECT')) AS readable_columns,
           (SELECT count(*)::int FROM t WHERE NOT home AND has_table_privilege(current_user, t.oid, 'SELECT')) AS readable_elsewhere,
           (SELECT count(*)::int FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(current_user, n.oid, 'CREATE')
              AND NOT has_schema_privilege('public', n.oid, 'CREATE')) AS create_schemas,
           (SELECT count(*)::int FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg_%' AND has_schema_privilege('public', n.oid, 'CREATE')) AS public_create_schemas,
           (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a JOIN t ON t.oid = a.attrelid
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
    out.readableTableList = priv.readable_tables ?? []
    // 허용 목록 밖에서 읽을 수 있는 컬럼(다른 스키마는 ~ 접두사). PUBLIC 의 컬럼 단위 권한까지 잡는다.
    out.unexpectedReadableColumns = ((priv.readable_columns ?? []) as string[]).filter((tc) => {
      const [table, column] = tc.split('.')
      if (table === 'member') return !['id', 'status', 'email_hash'].includes(column)
      return !ALLOWED_TABLES.includes(table)
    }).length
    out.readableTableNamesOk =
      ((priv.readable_tables ?? []) as string[]).join(',') === [...ALLOWED_TABLES].sort().join(',')
    out.readableElsewhere = priv.readable_elsewhere
    // 이 역할에 직접(또는 PUBLIC 이 아닌 경로로) 주어진 CREATE 는 없어야 한다. read-only 기본값은 세션에서 바꿀 수 있어 경계가 아니다.
    out.createSchemas = priv.create_schemas
    // PG14 기본값(PUBLIC 의 public 스키마 CREATE)은 오프닝 DB 공용 설정이라 경고로만 보고한다(사용자 결정 11-18).
    // 새 객체를 만들 수는 있어도 기존 데이터를 읽거나 바꾸지는 못한다.
    out.publicCreateSchemasWarn = priv.public_create_schemas
    out.memberColumns = priv.member_columns ?? []
    out.memberTotalColumns = priv.member_total_columns
    out.memberships = priv.memberships
    out.elevated = priv.elevated
    out.readOnlyDefault = (
      await op.query('SHOW transaction_read_only')
    ).rows[0].transaction_read_only
    // 실제 쓰기 시도가 읽기 전용(25006)으로 거부되는지. 앱 계정은 권한상 쓰기 가능하므로 이것이 경계다.
    await op.query('SAVEPOINT probe')
    try {
      await op.query('UPDATE brand SET id = id WHERE false')
      out.writeRejected = 'NOT_REJECTED'
    } catch (error) {
      out.writeRejected = (error as { code?: string }).code ?? 'UNKNOWN'
    }
    await op.query('ROLLBACK TO SAVEPOINT probe')
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
  const readable = (out.readableTableList ?? []) as string[]
  out.missingTables = ALLOWED_TABLES.filter((t) => !readable.includes(t)).length
  const common =
    out.missingTables === 0 &&
    out.readOnlyDefault === 'on' &&
    out.writeRejected === '25006' &&
    ['email_hash', 'id', 'status'].every((c) => memberColumns.includes(c)) &&
    samples.length > 0 &&
    s3Ok === samples.length
  // 전용 역할이면 카탈로그 유효 권한 경계까지, 앱 계정이면 세션 읽기 전용만 요구한다(권한 항목은 참고로만 출력).
  const ok = apiAccount
    ? common
    : common &&
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
      out.elevated === false
  delete out.readableTableList
  console.log(JSON.stringify({ status: ok ? 'VERIFIED' : 'CHECK_FAILED', ...out }))
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : ''
  console.log(
    JSON.stringify({
      status: 'BLOCKED',
      code: /^[A-Z_0-9]+$/.test(message) ? message : 'VERIFY_FAILED',
      // 진단용(OPENING_VERIFY_DEBUG=1): 오류 원문 앞부분만, URL·이메일은 가린다.
      ...(process.env.OPENING_VERIFY_DEBUG === '1'
        ? {
            detail: message
              .slice(0, 160)
              .replace(/\S+:\/\/\S+/g, '<url>')
              .replace(/\S+@\S+/g, '<email>'),
          }
        : {}),
    })
  )
  process.exitCode = 1
})
