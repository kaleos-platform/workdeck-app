/** @jest-environment node */
import { encryptPii } from '@/lib/del/encryption'
import { spawnSync } from 'node:child_process'
import { migrationHash, migrationSourceRef } from '../ledger'
import { recoverOpeningPosting } from '../posting-recovery'

const at = '2026-10-03T00:00:00Z'
const packet = {
  sourceSpaceId: '1',
  sourcePostingId: '9007199254740993',
  sourceMemberId: null,
  sourceSnapshotAt: at,
  posting: {
    uuid: 'qa',
    title: '합성 공고',
    status: 1,
    createdAt: at,
    updatedAt: at,
    closingDate: null,
    publishedAt: null,
    managerName: null,
    managerPhone: null,
    applicationEntries: [{ key: 'name', type: 'string', label: '이름', required: true }],
  },
  positions: [],
  storeIds: [],
  rawSnapshot: { synthetic: true },
  content: {
    detail: [{ type: 'posting_title', enabled: true }],
    postingTitle: '합성 공고',
    positionsVerified: false,
    originalApplyUrl: 'https://opening.work/qa',
    resources: {},
    images: {},
  },
}
const target = { sourceSpaceId: '1', spaceId: 'space-a', author: null }
const scope = { sourceSpaceId: '1', spaceId: 'space-a' }
function record(snapshot: unknown = { ...packet, target }) {
  const encrypted = encryptPii(JSON.stringify(snapshot))
  return {
    spaceId: 'space-a',
    targetModel: 'HiringPosting',
    transformVersion: 'posting-v1',
    sourceRef: migrationSourceRef({
      sourceSystem: 'opening.work',
      sourceTable: 'posting',
      sourceId: packet.sourcePostingId,
      occurrence: '0',
    }),
    sourceSnapshotAt: new Date(at),
    sourceHash: migrationHash(snapshot),
    sourceSnapshotEnc: encrypted.encrypted,
    sourceSnapshotIv: encrypted.iv,
  }
}
beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  process.env.ENCRYPTION_KEY_V1 = 'd'.repeat(64) // v1 루트 — v0 키(ENCRYPTION_KEY)와 다른 값
})

test.each(['v0', 'v1'])(
  '%s 암호화 원장에서 BIGINT 원본 ID와 실행 입력을 손실 없이 복원한다',
  (version) => {
    process.env.ENCRYPTION_WRITE_VERSION = version
    expect(recoverOpeningPosting(record(), scope)).toEqual({ packet, target })
  }
)

test.each([
  { spaceId: 'other' },
  { targetModel: 'HiringApplication' },
  { transformVersion: 'unknown' },
  { sourceRef: '["opening.work","posting","9","0"]' },
  { sourceRef: '["opening.work","posting","9007199254740993","1"]' },
  { sourceSnapshotAt: new Date('2026-10-04T00:00:00Z') },
  { sourceHash: '0'.repeat(64) },
])('원장 범위·무결성·버전 불일치를 거부한다: %j', (override) => {
  expect(() => recoverOpeningPosting({ ...record(), ...override }, scope)).toThrow(
    'POSTING_RECOVERY_FAILED'
  )
})

test('다른 원본 고객과 암호화 snapshot 내부 대상 불일치를 거부한다', () => {
  expect(() => recoverOpeningPosting(record(), { ...scope, sourceSpaceId: '2' })).toThrow(
    'POSTING_RECOVERY_FAILED'
  )
  expect(() =>
    recoverOpeningPosting(record({ ...packet, target: { ...target, spaceId: 'other' } }), scope)
  ).toThrow('POSTING_RECOVERY_FAILED')
})

test('schema 오류에 고객 원문을 노출하지 않는다', () => {
  const bad = { ...packet, posting: { ...packet.posting, title: '민감 원문'.repeat(100) }, target }
  expect(() => recoverOpeningPosting(record(bad), scope)).toThrow(/^POSTING_RECOVERY_FAILED$/)
})

test('CLI는 원문 없이 집계만 반환하고 쓰기 옵션은 거부한다', () => {
  const run = (extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        'scripts/audit-opening-recovery.mjs',
        '--source-space',
        '1',
        '--target-space',
        'space-a',
        ...extra,
      ],
      { input: JSON.stringify(record()), encoding: 'utf8', env: process.env }
    )
  const result = run()
  expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    status: 'RECOVERABLE',
    writes: 0,
    postings: 1,
    positions: 0,
    stores: 0,
  })
  expect(result.stdout + result.stderr).not.toContain('합성 공고')
  const blocked = run(['--apply'])
  expect(blocked.status).toBe(1)
  expect(JSON.parse(blocked.stderr)).toEqual({
    status: 'BLOCKED',
    code: 'MIGRATION_RECOVERY_FAILED',
  })
})
