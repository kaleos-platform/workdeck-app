import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inspectFileObjects } from '../audit-opening-file-objects.mjs'
test('범위 내 메타데이터만 조회하고 중복·누락·접근 실패를 구분한다', async () => {
  const calls = []
  const row = (key) => ({ file_key: key, storage: 'allowed', storage_type: 's3', status: 1 })
  const client = {
    query: async (sql) => {
      calls.push(sql)
      return {
        rows: sql.includes('FROM brand')
          ? [{ total: '1' }]
          : sql.includes('FROM file')
            ? [
                row('private-a'),
                row('private-a'),
                row('b'),
                row('c'),
                { ...row('d'), storage: 'other' },
              ]
            : [],
      }
    },
  }
  const report = await inspectFileObjects(client, ['7'], 'allowed', async (bucket, key) => {
    assert.equal(bucket, 'allowed')
    if (key === 'b') return { status: 'missing' }
    if (key === 'c') throw Error('private-error')
    return { status: 'found', bytes: 11 * 1024 * 1024, mime: 'application/pdf' }
  })
  assert.equal(calls.at(-1), 'ROLLBACK')
  assert.equal(report.references, 5)
  assert.equal(report.uniqueObjects, 3)
  assert.equal(report.metadataBlocked, 1)
  assert.equal(report.found, 1)
  assert.equal(report.missing, 1)
  assert.equal(report.inaccessible, 1)
  assert.equal(report.over10MiB, 1)
  assert.equal(report.contentChecksumVerified, false)
  assert.ok(!JSON.stringify(report).includes('private'))
})
