import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeOpeningContent,
  inspectContentReadiness,
} from '../audit-opening-content-readiness.mjs'

const posting = (detail, extra = {}) => ({
  id: '9007199254740993',
  brand_id: '17',
  detail,
  detail_image_key: '',
  posting_title_present: true,
  company_intro_present: true,
  ...extra,
})
const section = (type, extra = {}) => ({ type, enabled: true, ...extra })
const resource = {
  id: '23',
  status: 1,
  content_type: 'excalidraw',
  source_type: 'posting_detail',
  owner_brand_id: '17',
  image_key: 'private-image',
  file_key: 'private-scene',
}
const files = [
  {
    file_key: 'private-image',
    status: 1,
    target_type: 'content_image',
    storage_type: 's3',
    storage: 'public',
  },
  {
    file_key: 'private-scene',
    status: 1,
    target_type: 'content_data',
    storage_type: 's3',
    storage: 'private',
  },
]

test('9종 구조 검사와 asset 미검증을 구분하고 고객 원문을 노출하지 않는다', () => {
  const rows = [
    posting(
      ['posting_title', 'company_intro', 'posting_positions', 'posting_stores', 'manager'].map(
        (type) => section(type)
      )
    ),
    posting([section('custom', { items: [{ label: 'private-label', value: 'private-value' }] })]),
    posting([
      section('content', { resource_id: '23', image_key: 'private-image' }),
      section('content_link', {
        resource_id: '23',
        image_key: 'private-image',
        url: 'https://example.com/private-url',
      }),
      section('image', { image_key: 'private-image' }),
    ]),
  ]
  const report = summarizeOpeningContent(rows, [resource], files)
  assert.equal(report.total, 3)
  assert.equal(report.plannedStructural, 2)
  assert.equal(report.assetVerificationPending, 1)
  assert.equal(report.blocked, 0)
  for (const secret of [
    '9007199254740993',
    'private-label',
    'private-value',
    'private-image',
    'private-scene',
    'private-url',
  ])
    assert.ok(!JSON.stringify(report).includes(secret))
})

test('비활성 unknown은 보존하고 활성 unknown/속성/unsafe ID를 차단한다', () => {
  const report = summarizeOpeningContent(
    [
      posting([{ type: 'future' }]),
      posting([section('future')]),
      posting([section('manager', { unknown: 1 })]),
      posting([section('content', { resource_id: 9007199254740992 })]),
    ],
    [],
    []
  )
  assert.equal(report.plannedStructural, 1)
  assert.equal(report.blocked, 3)
  assert.equal(report.disabledSections, 1)
  assert.deepEqual(report.reasons, {
    unsupported_section: 1,
    unsupported_attribute: 1,
    invalid_resource_id: 1,
  })
})

test('cross-space·누락 scene·image key 불일치·파일 누락을 차단한다', () => {
  const row = posting([section('content', { resource_id: '23', image_key: 'private-image' })])
  for (const [patch, expected] of [
    [{ owner_brand_id: '18' }, 'cross_space_resource'],
    [{ file_key: '' }, 'missing_scene_key'],
    [{ image_key: 'other' }, 'image_source_mismatch'],
    [{ source_type: '' }, 'unknown_resource_owner'],
  ]) {
    assert.equal(
      summarizeOpeningContent([row], [{ ...resource, ...patch }], files).reasons[expected],
      1
    )
  }
  assert.equal(summarizeOpeningContent([row], [resource], []).blocked, 1)
})

test('whole detailImage 및 scene 없는 content_link도 object 검증 대기다', () => {
  const report = summarizeOpeningContent(
    [
      posting([], { detail_image_key: 'whole' }),
      posting([section('content_link', { resource_id: '23' })]),
    ],
    [{ ...resource, file_key: '' }],
    [...files, { ...files[0], file_key: 'whole', target_type: 'posting_detail_img' }]
  )
  assert.equal(report.assetVerificationPending, 2)
  assert.equal(report.wholeDetailImages, 1)
})

test('고객 scope 실패는 read-only rollback하며 원문을 출력하지 않는다', async () => {
  const calls = []
  await assert.rejects(
    inspectContentReadiness(
      {
        query: async (sql) => {
          calls.push(sql)
          return { rows: sql.includes('FROM brand') ? [{ total: '0' }] : [] }
        },
      },
      ['17']
    )
  )
  assert.equal(calls[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(calls.at(-1), 'ROLLBACK')
})

test('전체 조회는 고객 scope와 참조 ID·key를 parameter로 제한한다', async () => {
  const calls = []
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params })
      if (sql.includes('FROM brand')) return { rows: [{ total: '1' }] }
      if (sql.includes('transaction_timestamp')) return { rows: [{ snapshot_at: 'snapshot' }] }
      if (sql.includes('FROM posting WHERE'))
        return { rows: [posting([section('content', { resource_id: '23' })])] }
      if (sql.includes('FROM content c')) return { rows: [resource] }
      if (sql.includes('FROM file WHERE')) return { rows: files }
      return { rows: [] }
    },
  }
  const report = await inspectContentReadiness(client, ['17'])
  assert.equal(report.status, 'STRUCTURE_CHECKED_ONLY')
  assert.equal(report.content.assetVerificationPending, 1)
  assert.deepEqual(calls.find((call) => call.sql.includes('FROM posting WHERE')).params, [['17']])
  assert.deepEqual(calls.find((call) => call.sql.includes('FROM content c')).params, [['23']])
  assert.deepEqual(calls.find((call) => call.sql.includes('FROM file WHERE')).params, [
    ['private-image', 'private-scene'],
  ])
  assert.equal(calls.at(-1).sql, 'ROLLBACK')
})

test('SELECT 예외도 rollback하고 빈 scope는 transaction 전에 차단한다', async () => {
  const calls = []
  const client = {
    query: async (sql) => {
      calls.push(sql)
      if (sql.includes('FROM brand')) throw Error('private-error')
      return { rows: [] }
    },
  }
  await assert.rejects(inspectContentReadiness(client, ['17']))
  assert.equal(calls.at(-1), 'ROLLBACK')
  calls.length = 0
  await assert.rejects(inspectContentReadiness(client, []))
  assert.equal(calls.length, 0)
})

test('합법 file_key를 고정 집계하고 원본 scene 출처와 비교한다', () => {
  const rows = [posting([section('content', { resource_id: '23', file_key: 'private-scene' })])]
  const report = summarizeOpeningContent(rows, [resource], files)
  assert.equal(report.assetVerificationPending, 1)
  assert.equal(report.sectionFileKeyOccurrences, 1)
  assert.equal(report.reasons.unsupported_attribute, undefined)
  assert.ok(!JSON.stringify(report).includes('private-scene'))
  const stale = summarizeOpeningContent(
    [posting([section('content', { resource_id: '23', file_key: 'old-scene' })])],
    [resource],
    files
  )
  assert.equal(stale.sectionFileKeyStale, 1)
  assert.equal(stale.assetVerificationPending, 1)
})
