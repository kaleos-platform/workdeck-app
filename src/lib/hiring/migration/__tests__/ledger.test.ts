/** @jest-environment node */
import type { Prisma, HiringMigrationRecord } from '@/generated/prisma/client'
import {
  importMigrationRecord,
  migrationHash,
  migrationSourceRef,
  decodeMigrationSnapshot,
} from '../ledger'

const source = {
  sourceSystem: 'opening.work',
  sourceTable: 'applications',
  sourceId: '9007199254740993',
  occurrence: '0',
}
const input = {
  ...source,
  spaceId: 'space-a',
  sourceSnapshotAt: new Date('2026-01-01'),
  transformVersion: 'v1',
  snapshot: { name: '합성 이름', nested: { b: 2, a: 1 } },
  targetModel: 'HiringApplication',
}
let row: HiringMigrationRecord | null
let target: { id: string; spaceId: string; name: string } | null
const create = jest.fn(
  async () => (target = { id: 'target-a', spaceId: 'space-a', name: '합성 이름' })
)
const read = jest.fn(async () => target)
const ledgerCreate = jest.fn(
  async ({ data }) =>
    (row = { id: 'ledger-a', metadata: null, verifiedAt: null, createdAt: new Date(), ...data })
)
const tx = {
  hiringMigrationRecord: { findUnique: jest.fn(async () => row), create: ledgerCreate },
} as unknown as Prisma.TransactionClient
const run = (overrides = {}) =>
  importMigrationRecord(
    tx,
    { ...input, ...overrides },
    { create, read, snapshot: (value) => value }
  )

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  row = null
  target = null
  jest.clearAllMocks()
})

test('정렬된 JSON 해시와 BIGINT 문자열 식별자를 보존한다', () => {
  expect(migrationHash({ b: 1, a: [2, 3] })).toBe(migrationHash({ a: [2, 3], b: 1 }))
  expect(JSON.parse(migrationSourceRef(source))).toEqual([
    'opening.work',
    'applications',
    '9007199254740993',
    '0',
  ])
  expect(() => migrationHash({ bad: undefined })).toThrow()
  expect(() => migrationHash({ bad: Number.NaN })).toThrow()
})

test('최초 가져오기는 대상과 암호화 ledger를 같은 transaction에 기록하고 반복은 재사용한다', async () => {
  const first = await run()
  expect(first.status).toBe('created')
  expect(create).toHaveBeenCalledWith(tx)
  expect(row?.sourceSnapshotEnc).not.toContain('합성 이름')
  expect(decodeMigrationSnapshot(row!)).toEqual(input.snapshot)
  expect((await run()).status).toBe('existing')
  expect(create).toHaveBeenCalledTimes(1)
  expect(ledgerCreate).toHaveBeenCalledTimes(1)
})

test.each([
  [{ snapshot: { changed: true } }, 'source'],
  [{ transformVersion: 'v2' }, 'source'],
  [{ spaceId: 'space-b' }, 'space'],
])('원본·변환 버전·space 변경을 거부한다: %j', async (override, reason) => {
  await run()
  await expect(run(override)).rejects.toThrow(reason)
  expect(create).toHaveBeenCalledTimes(1)
})

test('대상 변경·삭제·다른 space 이동을 거부한다', async () => {
  await run()
  target!.name = '변경'
  await expect(run()).rejects.toThrow('target')
  target = { id: 'target-a', name: '합성 이름', spaceId: 'space-b' }
  await expect(run()).rejects.toThrow('target')
  target = null
  await expect(run()).rejects.toThrow('target')
})

test('snapshot 해시 손상을 탐지한다', async () => {
  await run()
  expect(() => decodeMigrationSnapshot({ ...row!, sourceHash: '0'.repeat(64) })).toThrow('snapshot')
})

test('ledger 저장 실패를 transaction 호출자에게 전파한다', async () => {
  ledgerCreate.mockRejectedValueOnce(new Error('transaction failure'))
  await expect(run()).rejects.toThrow('transaction failure')
})

test('생성된 대상이 다른 space이면 ledger를 저장하지 않는다', async () => {
  create.mockResolvedValueOnce({ id: 'foreign', spaceId: 'space-b', name: '합성 이름' })
  await expect(run()).rejects.toThrow('target')
  expect(ledgerCreate).not.toHaveBeenCalled()
})
