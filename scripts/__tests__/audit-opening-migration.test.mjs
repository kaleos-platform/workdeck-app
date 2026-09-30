import { test } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { queries, parseScope, inspect } from '../audit-opening-migration.mjs'

test('원본 고객이 존재하지 않으면 부분 보고서를 반환하지 않는다', async () => {
  const calls = []
  const client = {
    query: async (sql) => {
      calls.push(sql)
      return { rows: sql.includes('FROM brand') ? [{ total: '0' }] : [] }
    },
  }
  await assert.rejects(inspect(client, ['7']))
  assert.equal(calls.at(-1), 'ROLLBACK')
  assert.ok(!calls.includes(queries.postings))
})

test('미대응 항목이 있으면 검토 필요로 판정한다', async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes('FROM brand')) return { rows: [{ total: '1' }] }
      if (sql.includes('transaction_timestamp')) return { rows: [{ snapshot_at: '2026-09-27' }] }
      return { rows: Object.values(queries).includes(sql) ? [{ total: '2', flag: '1' }] : [] }
    },
  }
  assert.equal((await inspect(client, ['7'])).status, 'REVIEW_REQUIRED')
})

test('고객 범위는 명시적 BIGINT 문자열만 허용한다', () => {
  assert.deepEqual(parseScope(['--spaces', '9007199254740993,2,2']), ['9007199254740993', '2'])
  for (const args of [
    [],
    ['--all'],
    ['--spaces', ''],
    ['--spaces', '1;DROP'],
    ['--spaces', '-1'],
    ['--spaces', '9223372036854775808'],
  ]) {
    assert.throws(() => parseScope(args))
  }
})

test('조회 실패 시 읽기 전용 트랜잭션을 rollback한다', async () => {
  const calls = []
  const client = {
    query: async (sql) => {
      calls.push(sql)
      if (sql.startsWith('SELECT count')) throw new Error('synthetic failure')
      return { rows: [] }
    },
  }
  await assert.rejects(inspect(client, ['1']))
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls.at(-1), 'ROLLBACK')
})

test('결과는 집계만 출력하고 0건이어도 이전 완료로 판정하지 않는다', async () => {
  const client = {
    query: async (sql) => {
      if (sql.includes('FROM brand')) return { rows: [{ total: '1' }] }
      if (sql.includes('transaction_timestamp')) return { rows: [{ snapshot_at: '2026-09-27' }] }
      return {
        rows:
          sql.startsWith('SELECT') || sql.startsWith('WITH')
            ? [{ total: '2', sample_flag: '0' }]
            : [],
      }
    },
  }
  const report = await inspect(client, ['123456'])
  assert.equal(report.status, 'NO_FLAGS_IN_CHECKED_SCOPE')
  assert.ok(report.unverified.includes('s3_objects'))
  assert.ok(!JSON.stringify(report).includes('123456'))
})

// 테스트 데이터는 CTE로만 제공한다. 기존 테이블을 조회하거나 생성하지 않는다.
const fixture = `posting AS (
  SELECT 1::bigint id, 7::bigint brand_id, 0 status, 'encrypted-placeholder'::text manager_email_enc,
    '[{"key":"custom","type":"date"},{"key":"custom","type":"select","items":[{"label":"표시","value":"code"}]}]'::jsonb application_entries, '[]'::jsonb detail
  UNION ALL SELECT 2,7,1,'','{}','{}'
  UNION ALL SELECT 3,8,99,'','[]','[]'
), application AS (
  SELECT 1::bigint id, 7::bigint brand_id, 1::bigint posting_id, 0 status, NULL::timestamp deleted_at,
    now() optional_privacy_agreed_at, 99 stage, 1 hiring_stage, '[null,{"key":"name","type":"string","value":"synthetic-private"},{"key":"choice","type":"select","value":"yes"}]'::jsonb application_entries
  UNION ALL SELECT 2,7,3,1,NULL,NULL,1,1,'[]'
  UNION ALL SELECT 3,7,999,1,NULL,NULL,1,1,'[]'
), posting_position AS (
  SELECT 1::bigint posting_id, true scheduled_work, NULL::boolean variable_work_hours,
    ''::text job_days_custom, ''::text job_hours_custom, NULL::int probation_months, NULL::int contract_months,
    ''::text fixed_work_schedule_type, ''::text job_terms, true unknown_intake, 'recruiting'::text job_type, 'monthly'::text pay_frequency
), file AS (
  SELECT 1::bigint target_id, 'appl_userfile'::text target_type, ''::text file_key, 2 status
  UNION ALL SELECT 1,'content_image','other',1
)`

test(
  '합성 CTE의 SQL 집계는 고객 범위·깨진 JSON·중복 key·관계 오류를 구분한다',
  {
    skip: !process.env.AUDIT_TEST_DATABASE_URL,
  },
  async () => {
    const { Client } = pg
    const client = new Client({
      connectionString: process.env.AUDIT_TEST_DATABASE_URL,
      connectionTimeoutMillis: 10000,
      options: '-c default_transaction_read_only=on',
    })
    await client.connect()
    try {
      await client.query('BEGIN READ ONLY')
      await client.query("SET LOCAL statement_timeout = '15s'")
      const results = {}
      for (const [name, sql] of Object.entries(queries)) {
        const query = /^WITH /i.test(sql)
          ? `WITH ${fixture}, ${sql.slice(5)}`
          : `WITH ${fixture} ${sql}`
        results[name] = (await client.query(query, [['7']])).rows
      }
      assert.deepEqual(results.postings[0], {
        total: '2',
        deleted_status: '1',
        unknown_status: '0',
        manager_email: '1',
        invalid_entries: '1',
        invalid_detail: '1',
      })
      const forms = results.forms.find((row) => row.kind === 'posting')
      assert.equal(forms.duplicate_key, '1')
      assert.equal(forms.number_or_date, '1')
      assert.equal(forms.option_value_differs, '1')
      assert.equal(forms.invalid_entries, '1')
      assert.equal(results.forms.find((row) => row.kind === 'application').missing_key, '1')
      assert.equal(results.forms.find((row) => row.kind === 'application').invalid_options, '0')
      assert.equal(results.applications[0].cross_space_posting, '1')
      assert.equal(results.applications[0].missing_posting, '1')
      assert.equal(results.applications[0].optional_consent, '1')
      assert.equal(results.positions[0].unsupported_job_type, '1')
      assert.equal(results.files[0].total, '1')
      assert.ok(!JSON.stringify(results).includes('synthetic-private'))
    } finally {
      await client.query('ROLLBACK')
      await client.end()
    }
  }
)
