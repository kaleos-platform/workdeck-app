/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { encryptPii } from '@/lib/del/encryption'
import { migrationHash } from '@/lib/hiring/migration/ledger'

jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { $transaction: jest.fn(), workerToken: { findUnique: jest.fn(), update: jest.fn() } },
}))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({
  resolveCoupangWorkspaceForSpaceStrict: jest.fn(async () => null),
}))
import { prisma } from '@/lib/prisma'

const at = '2026-10-03T00:00:00Z'
const packet = {
  sourceSpaceId: '1',
  sourcePostingId: '10',
  sourceMemberId: null,
  sourceSnapshotAt: at,
  posting: {
    uuid: 'qa',
    title: '합성 원문',
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
  rawSnapshot: {},
  content: {
    detail: [{ type: 'posting_title', enabled: true }],
    postingTitle: '합성 원문',
    positionsVerified: false,
    originalApplyUrl: 'https://opening.work/qa',
    resources: {},
    images: {},
  },
  target: { sourceSpaceId: '1', spaceId: 'space-a', author: null },
}
function ledger() {
  const enc = encryptPii(JSON.stringify(packet))
  return {
    id: 'record-a',
    spaceId: 'space-a',
    targetId: 'target-a',
    targetModel: 'HiringPosting',
    transformVersion: 'posting-v1',
    sourceRef: '["opening.work","posting","10","0"]',
    sourceSnapshotAt: new Date(at),
    sourceHash: migrationHash(packet),
    targetHash: '0'.repeat(64),
    sourceSnapshotEnc: enc.encrypted,
    sourceSnapshotIv: enc.iv,
    metadata: null,
    verifiedAt: null,
    createdAt: new Date(at),
  }
}
const tx = {
  $executeRawUnsafe: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  spaceMember: { findMany: jest.fn() },
  hiringMigrationRecord: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
}
const call = (body: unknown = { customer: 'ameaning' }, key: string | null = 'test-worker') =>
  POST(
    new NextRequest('https://app.workdeck.work/api/worker/hiring-migration-audit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'x-worker-api-key': key } : {}) },
      body: JSON.stringify(body),
    })
  )
beforeEach(() => {
  jest.clearAllMocks()
  process.env.WORKER_API_KEY = 'test-worker'
  process.env.WORKER_LEGACY_KEY_ENABLED = '1'
  process.env.ENCRYPTION_KEY = 'ab'.repeat(32)
  process.env.ENCRYPTION_KEY_V1 = 'd'.repeat(64)
  tx.$queryRawUnsafe.mockResolvedValue([{ transaction_read_only: 'on' }])
  tx.spaceMember.findMany.mockResolvedValue([{ spaceId: 'space-a', role: 'OWNER' }])
  tx.hiringMigrationRecord.findFirst.mockResolvedValue(ledger())
  tx.hiringMigrationRecord.findMany.mockResolvedValue([ledger()])
  tx.hiringMigrationRecord.count.mockResolvedValue(1)
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn(tx))
})
test.each([null, 'wrong'])('인증 실패 %s는 DB 조회 전에 거부한다', async (key) => {
  const r = await call({}, key)
  expect(r.status).toBe(401)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
test.each([
  { customer: 'other' },
  { customer: 'ameaning', spaceId: 'other' },
  { customer: 'ameaning', after: '../bad' },
])('임의 고객·공간·잘못된 페이지 입력은 거부한다: %j', async (body) => {
  expect((await call(body)).status).toBe(400)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})
test('READ ONLY 범위에서 검사하고 원문·키·대상 식별자를 응답하지 않는다', async () => {
  const r = await call()
  expect(r.status).toBe(200)
  const body = await r.json()
  expect(body).toMatchObject({
    customer: 'ameaning',
    total: 1,
    next: null,
    summary: { checked: 1, integrityVerified: 1, recoveryFailed: 0 },
  })
  expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY')
  expect(tx.hiringMigrationRecord.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ spaceId: 'space-a' }), take: 26 })
  )
  expect(JSON.stringify(body)).not.toContain('합성 원문')
  expect(JSON.stringify(body)).not.toContain('target-a')
  expect(r.headers.get('cache-control')).toBe('private, no-store')
})
test('복수 소속 또는 READ ONLY 미확인은 고정 오류로 중단한다', async () => {
  tx.spaceMember.findMany.mockResolvedValue([
    { spaceId: 'space-a', role: 'OWNER' },
    { spaceId: 'space-b', role: 'OWNER' },
  ])
  const r = await call()
  expect(r.status).toBe(409)
  expect(tx.hiringMigrationRecord.findMany).not.toHaveBeenCalled()
  tx.spaceMember.findMany.mockResolvedValue([{ spaceId: 'space-a', role: 'OWNER' }])
  tx.$queryRawUnsafe.mockResolvedValue([{ transaction_read_only: 'off' }])
  expect((await call()).status).toBe(500)
})

test('공간별 토큰은 다른 고객을 검사하지 못하고 사용 시각도 변경하지 않는다', async () => {
  ;(prisma.workerToken.findUnique as jest.Mock).mockResolvedValue({
    id: 'token-a',
    spaceId: 'other-space',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60000),
    lastUsedAt: null,
  })
  const response = await call({ customer: 'ameaning' }, 'wdw_scoped')
  expect(response.status).toBe(403)
  expect(prisma.workerToken.update).not.toHaveBeenCalled()
  expect(tx.hiringMigrationRecord.findMany).not.toHaveBeenCalled()
})

test('페이지는 25건으로 제한하고 고정 상한·같은 고객 범위를 유지한다', async () => {
  tx.hiringMigrationRecord.findMany.mockResolvedValue(
    Array.from({ length: 26 }, (_, i) => ({
      ...ledger(),
      id: `record-${String(i).padStart(3, '0')}`,
    }))
  )
  tx.hiringMigrationRecord.count.mockResolvedValue(26)
  const response = await call({ customer: 'peakpay', through: 'record-z' })
  expect(await response.json()).toMatchObject({
    customer: 'peakpay',
    total: 26,
    through: 'record-z',
    next: 'record-024',
    summary: { checked: 25 },
  })
  expect(tx.spaceMember.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { user: { email: 'devops@workdeck.work' } } })
  )
  tx.hiringMigrationRecord.findMany.mockResolvedValue([{ ...ledger(), id: 'record-025' }])
  const last = await call({ customer: 'peakpay', through: 'record-z', after: 'record-024' })
  expect(await last.json()).toMatchObject({ next: null, summary: { checked: 1 } })
  expect(tx.hiringMigrationRecord.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: { spaceId: 'space-a', id: { lte: 'record-z', gt: 'record-024' } },
      take: 26,
    })
  )
})

test('손상된 기준 원장과 인증 DB 오류는 예외 원문을 응답하지 않는다', async () => {
  tx.hiringMigrationRecord.findFirst.mockResolvedValue({ ...ledger(), sourceHash: '0'.repeat(64) })
  expect((await call()).status).toBe(500)
  expect(tx.hiringMigrationRecord.findMany).not.toHaveBeenCalled()
  ;(prisma.workerToken.findUnique as jest.Mock).mockRejectedValue(new Error('합성 민감 오류'))
  const response = await call({ customer: 'ameaning' }, 'wdw_bad')
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ code: 'MIGRATION_AUDIT_FAILED' })
})
