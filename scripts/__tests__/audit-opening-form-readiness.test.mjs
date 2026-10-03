import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOpeningForms, inspectFormReadiness } from '../audit-opening-form-readiness.mjs'

test('실제 변환기의 보류 사유를 집계하고 원문·ID를 출력하지 않는다', () => {
  const report = summarizeOpeningForms([
    {
      id: '9007199254740993',
      application_entries: [{ key: 'custom', type: 'text', label: 'private-label' }],
    },
    {
      id: '2',
      application_entries: [
        { key: 'custom', type: 'file', label: 'private-label', max_file_count: 0 },
      ],
    },
    { id: '3', application_entries: null },
  ])
  assert.equal(report.total, report.planned + report.blocked)
  assert.deepEqual(report, {
    total: 3,
    planned: 1,
    blocked: 2,
    reasons: { FILE_POLICY_REVIEW_REQUIRED: 1, INVALID_SOURCE: 1 },
    filePolicies: [{ maxCount: 0, maxBytes: 'missing', fields: 1 }],
  })
  assert.ok(!JSON.stringify(report).includes('private-label'))
  assert.ok(!JSON.stringify(report).includes('9007199254740993'))
})
test('고객 범위 불일치 또는 조회 실패도 read-only transaction을 닫는다', async () => {
  const calls = []
  await assert.rejects(
    inspectFormReadiness(
      {
        query: async (sql) => {
          calls.push(sql)
          return { rows: sql.includes('FROM brand') ? [{ total: '0' }] : [] }
        },
      },
      ['7']
    )
  )
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls.at(-1), 'ROLLBACK')
})
