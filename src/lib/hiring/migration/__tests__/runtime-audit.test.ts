/** @jest-environment node */
import type { HiringMigrationRecord } from '@/generated/prisma/client'
import { encryptPii } from '@/lib/del/encryption'
import { migrationHash, migrationSourceRef } from '../ledger'
import { auditMigrationRecords } from '../runtime-audit'

const scope = { spaceId: 'space-a', sourceSpaceId: '1' }
function record(snapshot: unknown, overrides = {}): HiringMigrationRecord {
  const enc = encryptPii(JSON.stringify(snapshot))
  return {
    id: 'ledger-a',
    spaceId: scope.spaceId,
    targetId: 'target-a',
    targetModel: 'HiringStore',
    transformVersion: 'store-v1',
    sourceRef: migrationSourceRef({
      sourceSystem: 'opening.work',
      sourceTable: 'store',
      sourceId: '2',
      occurrence: '0',
    }),
    sourceHash: migrationHash(snapshot),
    targetHash: '0'.repeat(64),
    sourceSnapshotAt: new Date('2026-10-03T00:00:00Z'),
    sourceSnapshotEnc: enc.encrypted,
    sourceSnapshotIv: enc.iv,
    metadata: null,
    verifiedAt: null,
    createdAt: new Date('2026-10-03T00:00:00Z'),
    ...overrides,
  }
}
beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  process.env.ENCRYPTION_KEY_V1 = 'd'.repeat(64)
})

test.each(['v0', 'v1'])('%s 원장의 실제 무결성을 검증하고 원문은 반환하지 않는다', (version) => {
  process.env.ENCRYPTION_WRITE_VERSION = version
  const result = auditMigrationRecords(
    [record({ sourceSpaceId: '1', sensitive: '합성 비밀 원문' })],
    scope
  )
  expect(result).toMatchObject({
    checked: 1,
    integrityVerified: 1,
    integrityFailed: 0,
    scopeFailed: 0,
    models: { HiringStore: { checked: 1, integrityVerified: 1 } },
  })
  expect(JSON.stringify(result)).not.toContain('합성 비밀 원문')
  expect(JSON.stringify(result)).not.toContain('target-a')
})
test('손상과 다른 고객·sourceRef 불일치를 정상으로 세지 않는다', () => {
  const r = record({ sourceSpaceId: '1' })
  expect(auditMigrationRecords([{ ...r, sourceHash: '0'.repeat(64) }], scope)).toMatchObject({
    checked: 1,
    integrityFailed: 1,
    integrityVerified: 0,
  })
  expect(auditMigrationRecords([{ ...r, spaceId: 'other' }], scope)).toMatchObject({
    scopeFailed: 1,
    integrityVerified: 0,
  })
  expect(
    auditMigrationRecords([{ ...r, sourceRef: '["opening.work","application","2","0"]' }], scope)
  ).toMatchObject({ scopeFailed: 1, integrityVerified: 0 })
  expect(auditMigrationRecords([record({ sourceSpaceId: '2' })], scope)).toMatchObject({
    scopeFailed: 1,
  })
})

test('무결성 통과와 입력 복구 실패·미지원 모델을 구분한다', () => {
  const r = record(
    { sourceSpaceId: '1' },
    {
      targetModel: 'HiringApplication',
      transformVersion: 'application-v1',
      sourceRef: '["opening.work","application","2","0"]',
    }
  )
  expect(auditMigrationRecords([r], scope)).toMatchObject({
    checked: 1,
    integrityVerified: 1,
    recoveryFailed: 1,
  })
  expect(auditMigrationRecords([{ ...r, targetModel: 'UnexpectedModel' }], scope)).toMatchObject({
    checked: 1,
    unsupported: 1,
    integrityVerified: 0,
  })
})
