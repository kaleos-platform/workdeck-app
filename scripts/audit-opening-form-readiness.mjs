// 실제 변환기를 사용하는 읽기 전용 검사. 고객 원문·ID·접속 정보는 출력하지 않는다.
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createJiti } from 'jiti'
import { parse } from 'dotenv'
import pg from 'pg'
import { parseScope } from './audit-opening-migration.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') }, fsCache: false })
const { planOpeningForm } = await jiti.import('../src/lib/hiring/opening-form-migration.ts')

export function summarizeOpeningForms(rows) {
  const report = { total: rows.length, planned: 0, blocked: 0, reasons: {} }
  for (const row of rows) {
    const plan = planOpeningForm(`posting:${row.id}`, row.application_entries)
    if (plan.ok) report.planned++
    else {
      report.blocked++
      report.reasons[plan.code] = (report.reasons[plan.code] ?? 0) + 1
    }
  }
  const policies = new Map()
  for (const row of rows) {
    for (const field of Array.isArray(row.application_entries) ? row.application_entries : []) {
      if (!field || field.type !== 'file') continue
      // 속성 원문은 출력하지 않는다. 수치·누락·타입 분류만 집계한다.
      const classify = (v) =>
        v == null ? 'missing' : typeof v === 'number' && Number.isFinite(v) ? v : 'invalid_type'
      const item = {
        maxCount: classify(field.max_file_count),
        maxBytes: classify(field.max_file_size),
      }
      const key = JSON.stringify(item)
      const prev = policies.get(key) ?? { ...item, fields: 0 }
      prev.fields++
      policies.set(key, prev)
    }
  }
  report.filePolicies = [...policies.values()]
  return report
}

export async function inspectFormReadiness(client, ids) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '30s'")
    await client.query("SET LOCAL lock_timeout = '3s'")
    await client.query('SET LOCAL search_path = public, pg_catalog')
    const scope = await client.query(
      'SELECT count(*)::text AS total FROM brand WHERE id = ANY($1::bigint[])',
      [ids]
    )
    if (Number(scope.rows[0].total) !== ids.length) throw Error('scope')
    const stamp = await client.query('SELECT transaction_timestamp() AS snapshot_at')
    const { rows } = await client.query(
      'SELECT id::text, application_entries::jsonb FROM posting WHERE brand_id = ANY($1::bigint[]) ORDER BY id',
      [ids]
    )
    const forms = summarizeOpeningForms(rows)
    return {
      version: 1,
      snapshotAt: stamp.rows[0].snapshot_at,
      scopeCount: ids.length,
      status: forms.blocked ? 'REVIEW_REQUIRED' : 'FORMS_PLANNABLE_ONLY',
      forms,
      unverified: [
        'historical_submissions',
        'content',
        'file_objects',
        'accounts',
        'target_import',
      ],
    }
  } finally {
    await client.query('ROLLBACK')
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'OPENING_ENV_FILE=/secure/source.env OPENING_CA_FILE=/secure/ca.pem node scripts/audit-opening-form-readiness.mjs --spaces 1,2'
    )
    return 0
  }
  let client
  try {
    const ids = parseScope(args)
    const env = parse(readFileSync(process.env.OPENING_ENV_FILE))
    const url = new URL(env.DATABASE_URL)
    for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(key)
    client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: true, ca: readFileSync(process.env.OPENING_CA_FILE, 'utf8') },
      options: '-c default_transaction_read_only=on',
      application_name: 'opening-form-readiness',
    })
    await client.connect()
    const report = await inspectFormReadiness(client, ids)
    console.log(JSON.stringify(report, null, 2))
    return report.forms.blocked ? 2 : 0
  } catch {
    console.error(
      '폼 검사 실패: 고객 범위·접속 설정·TLS 인증서·원본 스키마를 확인하세요. 상세 원문은 출력하지 않습니다.'
    )
    return 1
  } finally {
    if (client) await client.end().catch(() => {})
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2))
