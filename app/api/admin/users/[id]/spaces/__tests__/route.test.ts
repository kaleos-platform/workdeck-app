/** @jest-environment node */
jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn(), writeAuditLog: jest.fn() }))
jest.mock('@/lib/supabase/admin', () => ({ getSupabaseAdminClient: jest.fn() }))
jest.mock('@/lib/spaces/owner-space-lock', () => ({ lockOwnerSpaces: jest.fn() }))
jest.mock('@/lib/spaces/enable-deck', () => ({
  ...jest.requireActual('@/lib/spaces/enable-deck'),
  enableDeckInTx: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    spaceMember: { findMany: jest.fn(), count: jest.fn() },
    space: { create: jest.fn() },
    openingMigrationJob: { findMany: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    $transaction: jest.fn(),
  },
}))

import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { EnableDeckError, enableDeckInTx } from '@/lib/spaces/enable-deck'
import { lockOwnerSpaces } from '@/lib/spaces/owner-space-lock'
import { POST } from '../route'

const m = prisma as unknown as {
  user: { findUnique: jest.Mock }
  spaceMember: { findMany: jest.Mock; count: jest.Mock }
  space: { create: jest.Mock }
  openingMigrationJob: { findMany: jest.Mock; updateMany: jest.Mock; findUnique: jest.Mock }
  $transaction: jest.Mock
}
const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'u-1' }),
  })
const authUser = (bannedUntil: string | null) =>
  jest.mocked(getSupabaseAdminClient).mockReturnValue({
    auth: {
      admin: {
        getUserById: jest
          .fn()
          .mockResolvedValue({ data: { user: { banned_until: bannedUntil } }, error: null }),
      },
    },
  } as never)

beforeEach(() => {
  jest.resetAllMocks()
  ;(requireOperator as jest.Mock).mockResolvedValue({ ok: true, user: { id: 'op-1' } })
  jest.mocked(enableDeckInTx).mockResolvedValue(undefined as never)
  m.$transaction.mockImplementation((fn) => fn(prisma))
  m.user.findUnique.mockResolvedValue({ id: 'u-1' })
  authUser(null)
  m.spaceMember.findMany.mockResolvedValue([])
  m.spaceMember.count.mockResolvedValue(2)
  m.space.create.mockResolvedValue({ id: 'sp-new', name: '대성산업' })
  m.openingMigrationJob.findMany.mockResolvedValue([])
  m.openingMigrationJob.updateMany.mockResolvedValue({ count: 1 })
})

it('비운영자는 404 를 그대로 받고 DB 에 접근하지 않는다', async () => {
  ;(requireOperator as jest.Mock).mockResolvedValue({
    ok: false,
    response: NextResponse.json({ message: 'Not Found' }, { status: 404 }),
  })
  expect((await call({ name: 'a' })).status).toBe(404)
  expect(m.user.findUnique).not.toHaveBeenCalled()
  expect(m.$transaction).not.toHaveBeenCalled()
})

it('잘못된 본문은 422', async () => {
  expect((await call({ name: '   ' })).status).toBe(422)
  expect((await call({ name: 'x'.repeat(61) })).status).toBe(422)
})

it('없는 사용자는 404', async () => {
  m.user.findUnique.mockResolvedValue(null)
  expect((await call({ name: 'a' })).status).toBe(404)
})

it('정지된 사용자는 409 이고 아무것도 만들지 않는다', async () => {
  authUser(new Date(Date.now() + 86_400_000).toISOString())
  expect((await call({ name: 'a' })).status).toBe(409)
  expect(m.$transaction).not.toHaveBeenCalled()
})

it('정상 생성은 201 — lock, OWNER 멤버십, 모집 관리 켜기, 감사 로그를 같은 tx 로', async () => {
  const res = await call({ name: '  대성산업  ' })
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ space: { id: 'sp-new', name: '대성산업' }, blockedJobs: 0 })
  expect(lockOwnerSpaces).toHaveBeenCalledWith(prisma, 'u-1')
  expect(m.space.create).toHaveBeenCalledWith({
    data: {
      name: '대성산업',
      type: 'PERSONAL',
      members: { create: { userId: 'u-1', role: 'OWNER' } },
    },
    select: { id: true, name: true },
  })
  expect(enableDeckInTx).toHaveBeenCalledWith(prisma, 'sp-new', 'recruiting', {
    trialOncePerOwner: false,
  })
  expect(writeAuditLog).toHaveBeenCalledWith(
    'op-1',
    'space.create',
    'space',
    'sp-new',
    { ownerUserId: 'u-1', name: '대성산업', enableRecruiting: true, blockedJobs: 0 },
    prisma
  )
})

it('enableRecruiting=false 면 업무를 켜지 않는다', async () => {
  expect((await call({ name: 'a', enableRecruiting: false })).status).toBe(201)
  expect(enableDeckInTx).not.toHaveBeenCalled()
})

it('준비중 업무면 403 이고 감사 로그를 남기지 않는다(tx 롤백)', async () => {
  jest.mocked(enableDeckInTx).mockRejectedValue(new EnableDeckError('DECK_CLOSED'))
  expect((await call({ name: 'a' })).status).toBe(403)
  expect(writeAuditLog).not.toHaveBeenCalled()
})

it('구독이 필요하면 402', async () => {
  jest.mocked(enableDeckInTx).mockRejectedValue(new EnableDeckError('DECK_SUBSCRIPTION_REQUIRED'))
  expect((await call({ name: 'a' })).status).toBe(402)
})

it('감사 로그 실패는 전체 실패(500)다', async () => {
  ;(writeAuditLog as jest.Mock).mockRejectedValue(new Error('audit down'))
  expect((await call({ name: 'a' })).status).toBe(500)
})

it('같은 OWNER 의 같은 이름(trim·NFC)이 있으면 409 + 기존 spaceId, 새로 만들지 않는다', async () => {
  m.spaceMember.findMany.mockResolvedValue([
    { space: { id: 'sp-old', name: ' 한 '.normalize('NFD') } },
  ])
  const res = await call({ name: '한'.normalize('NFC') })
  expect(res.status).toBe(409)
  expect((await res.json()).spaceId).toBe('sp-old')
  expect(m.space.create).not.toHaveBeenCalled()
  expect(writeAuditLog).not.toHaveBeenCalled()
})

it('진행 중 job(MATCHED·PLANNED·APPROVED)만 BLOCKED 로 무효화하고 건수를 알린다', async () => {
  m.openingMigrationJob.findMany.mockResolvedValue([
    { id: 'j1', status: 'APPROVED', blockReasons: [] },
    { id: 'j2', status: 'PLANNED', blockReasons: ['MULTIPLE_OWNER_SPACES'] },
  ])
  const res = await call({ name: 'a' })
  expect((await res.json()).blockedJobs).toBe(2)
  expect(m.openingMigrationJob.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        userId: 'u-1',
        OR: [
          { status: { in: ['MATCHED', 'PLANNED', 'APPROVED'] } },
          { status: 'BLOCKED', blockReasons: { equals: ['NO_TARGET_SPACE'] } },
        ],
      },
    })
  )
  expect(m.openingMigrationJob.updateMany).toHaveBeenCalledWith({
    // 조회한 사유가 그대로일 때만 바꾼다(동시에 더해진 MULTI_USER 보존)
    where: { id: 'j1', status: 'APPROVED', blockReasons: { equals: [] } },
    data: expect.objectContaining({
      status: 'BLOCKED',
      blockReasons: ['MULTIPLE_OWNER_SPACES'],
      approvedBy: null,
      approvedAt: null,
    }),
  })
  // 이미 사유가 있으면 중복해 넣지 않는다
  expect(m.openingMigrationJob.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ blockReasons: ['MULTIPLE_OWNER_SPACES'] }),
    })
  )
})

it('생성 후 OWNER Space 가 1개뿐이면 job 을 건드리지 않는다', async () => {
  m.spaceMember.count.mockResolvedValue(1)
  const res = await call({ name: 'a' })
  expect((await res.json()).blockedJobs).toBe(0)
  expect(m.openingMigrationJob.findMany).not.toHaveBeenCalled()
  expect(m.openingMigrationJob.updateMany).not.toHaveBeenCalled()
})

it('무효화 중 워커가 job 을 바꿔 0건이면 다시 읽어 재시도하고, 무효화 대상이 아니게 되면 멈춘다', async () => {
  m.openingMigrationJob.findMany.mockResolvedValue([
    { id: 'j1', status: 'MATCHED', blockReasons: [] },
    { id: 'j2', status: 'MATCHED', blockReasons: [] },
  ])
  // j1: 첫 update 0건(워커가 PLANNED 로 바꿈) → 재조회 PLANNED → 두 번째 update 1건
  // j2: 첫 update 0건 → 재조회 APPLYING(무효화 대상 아님) → 중단
  m.openingMigrationJob.updateMany
    .mockResolvedValueOnce({ count: 0 })
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 0 })
  m.openingMigrationJob.findUnique
    .mockResolvedValueOnce({ id: 'j1', status: 'PLANNED', blockReasons: [] })
    .mockResolvedValueOnce({ id: 'j2', status: 'APPLYING', blockReasons: [] })
  const res = await call({ name: 'a' })
  expect((await res.json()).blockedJobs).toBe(1)
  expect(m.openingMigrationJob.updateMany).toHaveBeenCalledTimes(3)
  expect(m.openingMigrationJob.updateMany).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: { id: 'j1', status: 'PLANNED', blockReasons: { equals: [] } },
    })
  )
})
