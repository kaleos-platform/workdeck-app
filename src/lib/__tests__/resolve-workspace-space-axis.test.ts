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
  resolveSpaceCoupangWorkspaceId: jest.fn(),
}))
jest.mock('@/lib/spaces/current-space', () => ({ resolveCurrentMembership: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    deckInstance: { findUnique: jest.fn() },
    workspace: { findUnique: jest.fn() },
  },
}))

import { getUser } from '@/hooks/use-user'
import { prisma } from '@/lib/prisma'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import { resolveSpaceCoupangWorkspaceId } from '@/lib/inv/resolve-coupang-workspace'
import { canWriteDeck, resolveDeckContext, resolveWorkspace } from '../api-helpers'

const m = prisma as unknown as {
  deckInstance: { findUnique: jest.Mock }
  workspace: { findUnique: jest.Mock }
}
const spaceWs = resolveSpaceCoupangWorkspaceId as jest.Mock
const member = (role: string) =>
  (resolveCurrentMembership as jest.Mock).mockResolvedValue({
    role,
    space: { id: 'sp-1', name: 'S' },
  })

beforeEach(() => {
  jest.resetAllMocks()
  ;(getUser as jest.Mock).mockResolvedValue({ id: 'u-1' })
  m.deckInstance.findUnique.mockResolvedValue({ isActive: true })
  spaceWs.mockResolvedValue(null)
  m.workspace.findUnique.mockResolvedValue(null)
})

test('구성원은 Space 해석기의 워크스페이스를 쓴다(본인 소유 조회 없음)', async () => {
  member('ADMIN')
  spaceWs.mockResolvedValue('ws-space')
  const r = await resolveWorkspace()
  expect(r).toMatchObject({ workspace: { id: 'ws-space' }, role: 'ADMIN' })
  expect(spaceWs).toHaveBeenCalledWith('sp-1', 'u-1')
  expect(m.workspace.findUnique).not.toHaveBeenCalled()
})

test('Space 해석 실패면 404(본인 소유로 새지 않는다)', async () => {
  member('ADMIN')
  m.workspace.findUnique.mockResolvedValue({ id: 'ws-own' })
  const r = await resolveWorkspace()
  expect('error' in r && r.error?.status).toBe(404)
})

test('MEMBER 의 쓰기는 403, ADMIN·OWNER 는 통과', async () => {
  spaceWs.mockResolvedValue('ws-space')
  member('MEMBER')
  const denied = await resolveWorkspace({ write: true })
  expect('error' in denied && denied.error?.status).toBe(403)
  expect(await resolveWorkspace()).toMatchObject({ workspace: { id: 'ws-space' } })
  for (const role of ['ADMIN', 'OWNER']) {
    member(role)
    expect(await resolveWorkspace({ write: true })).toMatchObject({
      workspace: { id: 'ws-space' },
    })
  }
})

test('Space 멤버십이 없으면 기존처럼 본인 소유 워크스페이스', async () => {
  ;(resolveCurrentMembership as jest.Mock).mockResolvedValue(null)
  m.workspace.findUnique.mockResolvedValue({ id: 'ws-own' })
  expect(await resolveWorkspace({ write: true })).toMatchObject({ workspace: { id: 'ws-own' } })
  expect(spaceWs).not.toHaveBeenCalled()
  expect(m.workspace.findUnique).toHaveBeenCalledWith({
    where: { ownerId: 'u-1' },
    select: { id: true },
  })
})

test('Deck 별 쓰기 최소 역할 — 재무만 ADMIN, 재고·콘텐츠·채용은 MEMBER 도 쓰기', async () => {
  member('MEMBER')
  const finance = await resolveDeckContext('finance', { write: true })
  expect('error' in finance && finance.error?.status).toBe(403)
  expect(await resolveDeckContext('finance')).toMatchObject({ role: 'MEMBER' })
  for (const deck of ['seller-hub', 'sales-content', 'recruiting']) {
    expect(await resolveDeckContext(deck, { write: true })).toMatchObject({ role: 'MEMBER' })
  }
  member('ADMIN')
  expect(await resolveDeckContext('finance', { write: true })).toMatchObject({ role: 'ADMIN' })
})

test('canWriteDeck — 화면 조회 전용 안내 판정이 서버 표와 같다', () => {
  expect(canWriteDeck('finance', 'MEMBER')).toBe(false)
  expect(canWriteDeck('coupang-ads', 'ADMIN')).toBe(true)
  expect(canWriteDeck('seller-hub', 'MEMBER')).toBe(true)
})
