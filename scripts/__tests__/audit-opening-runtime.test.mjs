import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditRuntimeCustomer } from '../audit-opening-runtime.mjs'

const stat = (checked) => ({
  checked,
  integrityVerified: checked,
  integrityFailed: 0,
  recoveryFailed: 0,
  scopeFailed: 0,
  unsupported: 0,
})
const reply = (checked, next, total = 26) => ({
  customer: 'peakpay',
  total,
  through: 'upper',
  next,
  summary: {
    ...stat(checked),
    models: { HiringPosting: stat(checked), HiringApplication: stat(0), HiringStore: stat(0) },
  },
})

test('모든 페이지의 건수가 맞을 때만 집계를 반환한다', async () => {
  const requests = []
  const result = await auditRuntimeCustomer('peakpay', async (input) => {
    requests.push(input)
    return requests.length === 1 ? reply(25, 'middle') : reply(1, null)
  })
  assert.equal(result.total, 26)
  assert.equal(result.summary.integrityVerified, 26)
  assert.equal(result.pages, 2)
  assert.deepEqual(requests[1], { customer: 'peakpay', through: 'upper', after: 'middle' })
})
test('중도 종료·상한 변경·반복 cursor를 거부한다', async () => {
  await assert.rejects(
    auditRuntimeCustomer('peakpay', async () => reply(25, null)),
    /AUDIT_INCOMPLETE/
  )
  let calls = 0
  await assert.rejects(
    auditRuntimeCustomer('peakpay', async () =>
      ++calls === 1 ? reply(25, 'middle', 100) : { ...reply(25, 'other', 100), through: 'changed' }
    ),
    /AUDIT_BOUNDARY_CHANGED/
  )
  await assert.rejects(
    auditRuntimeCustomer('peakpay', async () => reply(25, 'middle', 100)),
    /AUDIT_CURSOR_INVALID/
  )
})
test('실패 건수를 성공으로 바꾸지 않고 미지원 고객을 거부한다', async () => {
  const report = await auditRuntimeCustomer('peakpay', async () => {
    const r = reply(1, null, 1)
    r.summary.integrityVerified = 0
    r.summary.integrityFailed = 1
    r.summary.models.HiringPosting.integrityVerified = 0
    r.summary.models.HiringPosting.integrityFailed = 1
    return r
  })
  assert.equal(report.summary.integrityFailed, 1)
  await assert.rejects(
    auditRuntimeCustomer('other', async () => {
      throw Error('must not request')
    }),
    /INVALID_CUSTOMER/
  )
})

test('모델별 합계가 전체 합계와 다르면 완료로 보고하지 않는다', async () => {
  await assert.rejects(
    auditRuntimeCustomer('peakpay', async () => {
      const r = reply(1, null, 1)
      r.summary.models.HiringPosting = stat(0)
      return r
    }),
    /AUDIT_COUNTS_INVALID/
  )
})

test('파일 검사 모드 누락과 불완전 집계를 완료로 보고하지 않는다', async () => {
  await assert.rejects(
    auditRuntimeCustomer('peakpay', async () => reply(1, null, 1), true),
    /AUDIT_ASSETS_INVALID/
  )
  const stat = {
    checked: 1,
    verified: 1,
    manifestMissing: 0,
    manifestInvalid: 0,
    readFailed: 0,
    sizeMismatch: 0,
    checksumMismatch: 0,
  }
  let request
  const report = await auditRuntimeCustomer(
    'peakpay',
    async (input) => {
      request = input
      return {
        ...reply(1, null, 1),
        assets: { images: stat, attachments: { ...stat, checked: 0, verified: 0 } },
      }
    },
    true
  )
  assert.equal(request.assets, true)
  assert.equal(report.assets.images.verified, 1)
  await assert.rejects(
    auditRuntimeCustomer(
      'peakpay',
      async () => ({
        ...reply(1, null, 1),
        assets: { images: { ...stat, checked: 2 }, attachments: stat },
      }),
      true
    ),
    /AUDIT_ASSETS_INVALID/
  )
})
