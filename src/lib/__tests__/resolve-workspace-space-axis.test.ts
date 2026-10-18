/** @jest-environment node */
jest.mock('next/headers', () => ({ headers: async () => new Headers() }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('@/lib/billing/entitlement', () => ({ assertDeckWritable: jest.fn(async () => null) }))
jest.mock('@/lib/worker-auth', () => ({
  authenticateWorker: jest.fn(),
  resolveWorkerWorkspaceId: jest.fn(),
}))
jest.mock('@/lib/coupang-ads/server-timing', () => ({
  measureCoupangAds: (_: string, fn: () => unknown) => fn(),
}))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({
  resolveCoupangWorkspaceForSpace: jest.fn(),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceMember: { findFirst: jest.fn() },
    deckInstance: { findUnique: jest.fn() },
    workspace: { findUnique: jest.fn() },
  },
}))

import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import { resolveWorkspace } from '../api-helpers'

const m = prisma as unknown as {
  spaceMember: { findFirst: jest.Mock }
  deckInstance: { findUnique: jest.Mock }
  workspace: { findUnique: jest.Mock }
}
const coupang = resolveCoupangWorkspaceForSpace as jest.Mock
const member = (role: string) =>
  m.spaceMember.findFirst.mockResolvedValue({ role, space: { id: 'sp-1', name: 'S' } })

beforeEach(() => {
  jest.resetAllMocks()
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'u-1' })
  m.deckInstance.findUnique.mockResolvedValue({ isActive: true })
  coupang.mockResolvedValue(null)
  m.workspace.findUnique.mockResolvedValue(null)
})

test('구성원은 Space 의 쿠팡 워크스페이스를 쓴다(본인 소유 조회 없음)', async () => {
  member('ADMIN')
  coupang.mockResolvedValue({ workspaceId: 'ws-coupang', locationId: 'loc' })
  const r = await resolveWorkspace()
  expect(r).toMatchObject({ workspace: { id: 'ws-coupang' }, role: 'ADMIN' })
  expect(m.workspace.findUnique).not.toHaveBeenCalled()
})

test('쿠팡 위치가 없으면 Space 에 연결된 워크스페이스, 그것도 없으면 본인 소유', async () => {
  member('MEMBER')
  m.workspace.findUnique.mockImplementation(({ where }) =>
    where.spaceId ? { id: 'ws-linked' } : { id: 'ws-own' }
  )
  expect(await resolveWorkspace()).toMatchObject({ workspace: { id: 'ws-linked' } })
  m.workspace.findUnique.mockImplementation(({ where }) =>
    where.spaceId ? null : { id: 'ws-own' }
  )
  expect(await resolveWorkspace()).toMatchObject({ workspace: { id: 'ws-own' } })
})

test('MEMBER 의 쓰기는 403, ADMIN·OWNER 는 통과', async () => {
  coupang.mockResolvedValue({ workspaceId: 'ws-coupang', locationId: 'loc' })
  member('MEMBER')
  const denied = await resolveWorkspace({ write: true })
  expect('error' in denied && denied.error?.status).toBe(403)
  expect(await resolveWorkspace()).toMatchObject({ workspace: { id: 'ws-coupang' } })
  for (const role of ['ADMIN', 'OWNER']) {
    member(role)
    expect(await resolveWorkspace({ write: true })).toMatchObject({
      workspace: { id: 'ws-coupang' },
    })
  }
})

test('Space 멤버십이 없으면 기존처럼 본인 소유 워크스페이스', async () => {
  m.spaceMember.findFirst.mockResolvedValue(null)
  m.workspace.findUnique.mockResolvedValue({ id: 'ws-own' })
  expect(await resolveWorkspace({ write: true })).toMatchObject({ workspace: { id: 'ws-own' } })
  expect(coupang).not.toHaveBeenCalled()
  expect(m.workspace.findUnique).toHaveBeenCalledWith({
    where: { ownerId: 'u-1' },
    select: { id: true },
  })
})
