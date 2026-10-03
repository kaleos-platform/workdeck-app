// 고객별 이전 차이 집계 전용. 원문·ID·접속 오류 내용은 출력하지 않는다.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import pg from 'pg'
const { Client } = pg
import { parse } from 'dotenv'

const queries = {
  postings: `SELECT count(*)::text AS total,
    count(*) FILTER (WHERE status = 0)::text AS deleted_status,
    count(*) FILTER (WHERE status IS NULL OR status NOT IN (0,1,2,3,4))::text AS unknown_status,
    count(*) FILTER (WHERE nullif(manager_email_enc, '') IS NOT NULL)::text AS manager_email,
    count(*) FILTER (WHERE jsonb_typeof(application_entries::jsonb) IS DISTINCT FROM 'array')::text AS invalid_entries,
    count(*) FILTER (WHERE jsonb_typeof(detail::jsonb) IS DISTINCT FROM 'array')::text AS invalid_detail
    FROM posting WHERE brand_id = ANY($1::bigint[])`,
  forms: `WITH records AS (
    SELECT 'posting' AS kind, application_entries::jsonb AS entries FROM posting WHERE brand_id = ANY($1::bigint[])
    UNION ALL
    SELECT 'application', application_entries::jsonb FROM application WHERE brand_id = ANY($1::bigint[])
  ), flags AS (
    SELECT kind,
      jsonb_typeof(entries) IS DISTINCT FROM 'array' AS invalid_entries,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'key') IS DISTINCT FROM 'string' OR coalesce(e->>'key','') = '') AS missing_key,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        GROUP BY e->>'key' HAVING count(*) > 1) AS duplicate_key,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE e->>'type' IN ('number','date')) AS number_or_date,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE e->>'type' IS NULL OR e->>'type' NOT IN ('string','text','select','multiselect','file','email','phone','number','date')) AS unknown_type,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE kind = 'posting' AND e->>'type' IN ('select','multiselect') AND jsonb_typeof(e->'items') IS DISTINCT FROM 'array') AS invalid_options,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e,
        LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e->'items') = 'array' THEN e->'items' ELSE '[]'::jsonb END) o
        WHERE jsonb_typeof(o) IS DISTINCT FROM 'object' OR jsonb_typeof(o->'label') IS DISTINCT FROM 'string'
          OR NOT (o ? 'value') OR o->'label' IS DISTINCT FROM o->'value') AS option_value_differs,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE e->>'other_option' = 'true') AS other_option,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE e->>'is_other' = 'true') AS submitted_other,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE e->>'max_file_count' IS NOT NULL OR e->>'max_file_size' IS NOT NULL) AS file_limits,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE e->>'min_length' IS NOT NULL OR e->>'max_length' IS NOT NULL) AS length_limits,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE coalesce(e->>'error_message','') <> '') AS custom_error_message,
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END) e
        WHERE coalesce(e->>'description','') <> '' OR coalesce(e->>'placeholder','') <> ''
          OR e->>'other_option' = 'true' OR e->>'is_other' = 'true'
          OR e->>'min_length' IS NOT NULL OR e->>'max_length' IS NOT NULL
          OR e->>'max_file_count' IS NOT NULL OR e->>'max_file_size' IS NOT NULL) AS extra_constraints
    FROM records
  ) SELECT kind, count(*)::text AS total,
    count(*) FILTER (WHERE invalid_entries)::text AS invalid_entries,
    count(*) FILTER (WHERE missing_key)::text AS missing_key,
    count(*) FILTER (WHERE duplicate_key)::text AS duplicate_key,
    count(*) FILTER (WHERE number_or_date)::text AS number_or_date,
    count(*) FILTER (WHERE unknown_type)::text AS unknown_type,
    count(*) FILTER (WHERE invalid_options)::text AS invalid_options,
    count(*) FILTER (WHERE option_value_differs)::text AS option_value_differs,
    count(*) FILTER (WHERE other_option)::text AS other_option,
    count(*) FILTER (WHERE submitted_other)::text AS submitted_other,
    count(*) FILTER (WHERE file_limits)::text AS file_limits,
    count(*) FILTER (WHERE length_limits)::text AS length_limits,
    count(*) FILTER (WHERE custom_error_message)::text AS custom_error_message,
    count(*) FILTER (WHERE extra_constraints)::text AS extra_constraints
    FROM flags GROUP BY kind ORDER BY kind`,
  positions: `SELECT count(*)::text AS total,
    count(*) FILTER (WHERE pp.scheduled_work IS NOT NULL OR pp.variable_work_hours IS NOT NULL
      OR coalesce(pp.job_days_custom,'') <> '' OR coalesce(pp.job_hours_custom,'') <> ''
      OR pp.probation_months IS NOT NULL OR pp.contract_months IS NOT NULL
      OR coalesce(pp.fixed_work_schedule_type,'') <> '' OR coalesce(pp.job_terms,'') <> ''
      OR pp.unknown_intake = true)::text AS extra_work_conditions,
    count(*) FILTER (WHERE pp.job_type IS NULL OR pp.job_type NOT IN ('','full_time','part_time','contract','free_lancer','intern'))::text AS unsupported_job_type,
    count(*) FILTER (WHERE pp.pay_frequency IS NULL OR pp.pay_frequency NOT IN ('','hourly','daily','weekly','monthly','yearly','per_task','tbd'))::text AS unsupported_pay_frequency
    FROM posting_position pp JOIN posting p ON p.id = pp.posting_id WHERE p.brand_id = ANY($1::bigint[])`,
  applications: `SELECT count(*)::text AS total,
    count(*) FILTER (WHERE a.optional_privacy_agreed_at IS NOT NULL)::text AS optional_consent,
    count(*) FILTER (WHERE a.status = 0 AND a.deleted_at IS NULL)::text AS inactive_without_deleted_at,
    count(*) FILTER (WHERE a.stage IS NULL OR a.stage NOT IN (1,3,4) OR a.hiring_stage IS NULL OR a.hiring_stage NOT IN (1,2,3))::text AS unknown_stage,
    count(*) FILTER (WHERE p.id IS NULL)::text AS missing_posting,
    count(*) FILTER (WHERE p.id IS NOT NULL AND p.brand_id IS DISTINCT FROM a.brand_id)::text AS cross_space_posting
    FROM application a LEFT JOIN posting p ON p.id = a.posting_id WHERE a.brand_id = ANY($1::bigint[])`,
  files: `SELECT count(*)::text AS total,
    count(*) FILTER (WHERE nullif(f.file_key,'') IS NULL)::text AS missing_key,
    count(*) FILTER (WHERE f.status IS DISTINCT FROM 1)::text AS not_active
    FROM file f JOIN application a ON a.id = f.target_id
    WHERE f.target_type = 'appl_userfile' AND a.brand_id = ANY($1::bigint[])`,
}

function parseScope(args) {
  if (args.length !== 2 || args[0] !== '--spaces') throw new Error('scope')
  const ids = args[1].split(',')
  if (
    ids.length > 100 ||
    ids.some((id) => !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
  )
    throw new Error('scope')
  return [...new Set(ids)]
}

async function inspect(client, ids) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '30s'")
    await client.query("SET LOCAL lock_timeout = '3s'")
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'")
    await client.query('SET LOCAL search_path = public, pg_catalog')
    const { rows: scope } = await client.query(
      'SELECT count(*)::text AS total FROM brand WHERE id = ANY($1::bigint[])',
      [ids]
    )
    if (Number(scope[0].total) !== ids.length) throw new Error('scope')
    const { rows: stamp } = await client.query('SELECT transaction_timestamp() AS snapshot_at')
    const metrics = {}
    for (const [name, sql] of Object.entries(queries)) {
      metrics[name] = (await client.query(sql, [ids])).rows
    }
    // 지표가 겹치므로 합산하지 않는다. 하나라도 해당하면 개별 변환 방침이 필요하다.
    const reviewRequired = Object.values(metrics).some((rows) =>
      rows.some((row) =>
        Object.entries(row).some(
          ([key, value]) => key !== 'total' && key !== 'kind' && BigInt(value) > 0n
        )
      )
    )
    return {
      version: 3,
      snapshotAt: stamp[0].snapshot_at,
      scopeCount: ids.length,
      status: reviewRequired ? 'REVIEW_REQUIRED' : 'NO_FLAGS_IN_CHECKED_SCOPE',
      metrics,
      unverified: [
        'content_mapping',
        'public_asset_references',
        's3_objects',
        'accounts',
        'billing',
        'target_import',
        'historical_form_matching',
      ],
    }
  } finally {
    await client.query('ROLLBACK')
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'OPENING_ENV_FILE=/secure/opening.env node scripts/audit-opening-migration.mjs --spaces 1,2\n종료 코드: 0=검사 범위 내 플래그 없음(이전 승인 아님), 2=검토 필요, 1=검사 실패\n'
    )
    return 0
  }
  let client
  try {
    const ids = parseScope(args)
    // Workdeck 환경 파일을 자동으로 읽지 않는다. 전용 파일로 접속 대상을 지정한다.
    if (!process.env.OPENING_ENV_FILE) throw new Error('config')
    const env = parse(readFileSync(process.env.OPENING_ENV_FILE))
    if (!env.DATABASE_URL) throw new Error('config')
    client = new Client({
      connectionString: env.DATABASE_URL,
      connectionTimeoutMillis: 10000,
      application_name: 'opening-migration-audit',
      options: '-c default_transaction_read_only=on',
    })
    await client.connect()
    const report = await inspect(client, ids)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return report.status === 'REVIEW_REQUIRED' ? 2 : 0
  } catch {
    // 접속 문자열·SQL detail에 개인정보가 포함될 수 있어 예외 원문을 출력하지 않는다.
    process.stderr.write(
      '검사 실패: --spaces, OPENING_ENV_FILE, 접속 권한·네트워크·원본 스키마를 확인하세요. 상세 오류는 출력하지 않습니다.\n'
    )
    return 1
  } finally {
    if (client) await client.end().catch(() => {})
  }
}

export { queries, parseScope, inspect }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
