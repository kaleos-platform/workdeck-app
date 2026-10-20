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
jest.mock('@/lib/hiring/migration/application-target-audit', () => ({
  compareOpeningApplicationTarget: jest.fn(),
}))
import { compareOpeningApplicationTarget } from '@/lib/hiring/migration/application-target-audit'

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
  hiringApplication: { findFirst: jest.fn() },
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

test('파일 검사는 원장 1건씩 순회하고 집계만 반환한다', async () => {
  const r = await call({ customer: 'ameaning', assets: true })
  expect(r.status).toBe(200)
  const body = await r.json()
  expect(body.assets).toMatchObject({ images: { checked: 0 }, attachments: { checked: 0 } })
  expect(tx.hiringMigrationRecord.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ take: 2 })
  )
  expect(body).not.toHaveProperty('assetWork')
})

test('원장의 이미지 bytes를 transaction 이후 읽고 경로·manifest를 노출하지 않는다', async () => {
  const { createHash } = await import('node:crypto')
  const bytes = Buffer.from('합성 이미지')
  const snapshot = {
    ...packet,
    content: {
      ...packet.content,
      detailImage: {
        copiedImagePath: 'space-a/migration/qa.png',
        verified: true,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
  }
  const enc = encryptPii(JSON.stringify(snapshot))
  const record = {
    ...ledger(),
    sourceHash: migrationHash(snapshot),
    sourceSnapshotEnc: enc.encrypted,
    sourceSnapshotIv: enc.iv,
  }
  tx.hiringMigrationRecord.findFirst.mockResolvedValue(record)
  tx.hiringMigrationRecord.findMany.mockResolvedValue([record])
  let transactionEnded = false
  ;(prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
    const result = await fn(tx)
    transactionEnded = true
    return result
  })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-key'
  const read = jest.spyOn(global, 'fetch').mockImplementation(async () => {
    expect(transactionEnded).toBe(true)
    return new Response(bytes)
  })
  try {
    const r = await call({ customer: 'ameaning', assets: true })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.assets.images).toMatchObject({ checked: 1, verified: 1 })
    expect(read).toHaveBeenCalledWith(
      'https://example.supabase.co/storage/v1/object/authenticated/hiring-assets/space-a/migration/qa.png',
      expect.objectContaining({ method: 'GET' })
    )
    expect(JSON.stringify(body)).not.toContain('qa.png')
    expect(JSON.stringify(body)).not.toContain('합성 이미지')
    expect(JSON.stringify(body)).not.toContain(snapshot.content.detailImage.sha256)
  } finally {
    read.mockRestore()
  }
})

test.each([
  { customer: 'peakpay', verifyApplications: [] },
  { customer: 'peakpay', verifyApplications: ['1', '1'] },
  { customer: 'peakpay', verifyApplications: ['../bad'] },
  { customer: 'peakpay', verifyApplications: Array.from({ length: 8 }, (_, i) => String(i + 1)) },
  { customer: 'peakpay', verifyApplications: ['1'], after: 'record-a', through: 'record-z' },
])('지원서 검사의 잘못된 범위는 조회 전 거부한다: %j', async (body) => {
  expect((await call(body)).status).toBe(400)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

test('선택 지원서만 같은 고객에서 읽고 차이 항목 집계만 반환한다', async () => {
  const record = {
    ...ledger(),
    targetModel: 'HiringApplication',
    sourceRef: '["opening.work","application","3","0"]',
  }
  tx.hiringMigrationRecord.findMany.mockResolvedValue([record])
  tx.hiringApplication.findFirst.mockResolvedValue({ id: 'target-a', spaceId: 'space-a' })
  ;(compareOpeningApplicationTarget as jest.Mock).mockReturnValue({
    status: 'different',
    physicalHashMatches: false,
    differentGroups: ['pii', 'files'],
  })
  const response = await call({ customer: 'peakpay', verifyApplications: ['3', '4'] })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    customer: 'peakpay',
    applicationTargets: {
      checked: 1,
      verified: 0,
      different: 1,
      failed: 0,
      missingTargets: 0,
      missingRecords: 1,
      physicalHashMatches: 0,
      differences: { pii: 1, files: 1 },
    },
  })
  expect(tx.hiringMigrationRecord.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        spaceId: 'space-a',
        targetModel: 'HiringApplication',
        sourceRef: {
          in: ['["opening.work","application","3","0"]', '["opening.work","application","4","0"]'],
        },
      }),
    })
  )
  expect(tx.hiringApplication.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'target-a', spaceId: 'space-a' } })
  )
  expect(tx.$executeRawUnsafe).toHaveBeenCalledWith('SET TRANSACTION READ ONLY')
  expect(prisma.workerToken.update).not.toHaveBeenCalled()
})
