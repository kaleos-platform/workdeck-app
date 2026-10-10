/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { resolveCoupangWorkspaceForSpace } from '@/lib/inv/resolve-coupang-workspace'
import {
  assertWorkerOwns,
  authenticateWorker,
  generateWorkerToken,
  hashWorkerToken,
  resolveWorkerWorkspaceId,
  workerTokenExpiry,
  workerWorkspaceWhere,
  type WorkerScope,
} from '../worker-auth'

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    workerToken: { findUnique: jest.fn(), update: jest.fn() },
    workspace: { findUnique: jest.fn(), findFirst: jest.fn() },
    invStorageLocation: { findFirst: jest.fn() },
  },
}))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({
  resolveCoupangWorkspaceForSpace: jest.fn(),
}))

const mock = prisma as unknown as {
  workerToken: { findUnique: jest.Mock; update: jest.Mock }
}
const resolveWs = resolveCoupangWorkspaceForSpace as jest.Mock

function h(key?: string) {
  return new Headers(key ? { 'x-worker-api-key': key } : {})
}
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000)
const spaceA: WorkerScope = {
  kind: 'space',
  tokenId: 't1',
  spaceId: 'space-a',
  workspaceId: 'ws-a',
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.WORKER_LEGACY_KEY_ENABLED
  process.env.WORKER_API_KEY = 'legacy-key'
  mock.workerToken.update.mockResolvedValue({})
})

describe('authenticateWorker', () => {
  test('헤더 없음 → 401', async () => {
    const r = await authenticateWorker(h())
    expect('error' in r && r.error.status).toBe(401)
  })

  test('유효 토큰 → Space 범위 + 연결된 쿠팡 워크스페이스', async () => {
    const { token, tokenHash } = generateWorkerToken()
    expect(token.startsWith('wdw_')).toBe(true)
    expect(tokenHash).toBe(hashWorkerToken(token))
    mock.workerToken.findUnique.mockResolvedValue({
      id: 't1',
      spaceId: 'space-a',
      revokedAt: null,
      expiresAt: FUTURE,
      lastUsedAt: null,
    })
    resolveWs.mockResolvedValue({ workspaceId: 'ws-a', locationId: 'loc' })

    const r = await authenticateWorker(h(token))
    expect(r).toEqual({ scope: spaceA })
    expect(mock.workerToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash } })
    )
    expect(mock.workerToken.update).toHaveBeenCalled() // lastUsedAt 갱신
  })

  test('폐기된 토큰 → 401', async () => {
    mock.workerToken.findUnique.mockResolvedValue({
      id: 't1',
      spaceId: 'space-a',
      revokedAt: new Date(),
      expiresAt: FUTURE,
      lastUsedAt: null,
    })
    const r = await authenticateWorker(h('wdw_revoked'))
    expect('error' in r && r.error.status).toBe(401)
  })

  test('만료된 토큰 → 401, lastUsedAt 갱신 없음', async () => {
    mock.workerToken.findUnique.mockResolvedValue({
      id: 't1',
      spaceId: 'space-a',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      lastUsedAt: null,
    })
    const r = await authenticateWorker(h('wdw_expired'))
    expect('error' in r && r.error.status).toBe(401)
    expect(mock.workerToken.update).not.toHaveBeenCalled()
  })

  test('발급 TTL 은 1~365일만 허용한다', () => {
    const now = new Date('2026-10-09T00:00:00Z')
    expect(workerTokenExpiry(90, now).toISOString()).toBe('2027-01-07T00:00:00.000Z')
    expect(() => workerTokenExpiry(0, now)).toThrow()
    expect(() => workerTokenExpiry(366, now)).toThrow()
  })

  test('없는 토큰 → 401', async () => {
    mock.workerToken.findUnique.mockResolvedValue(null)
    const r = await authenticateWorker(h('wdw_unknown'))
    expect('error' in r && r.error.status).toBe(401)
  })

  test('레거시 키는 WORKER_LEGACY_KEY_ENABLED=1 일 때만 통과', async () => {
    expect('error' in (await authenticateWorker(h('legacy-key')))).toBe(true)
    process.env.WORKER_LEGACY_KEY_ENABLED = '1'
    expect(await authenticateWorker(h('legacy-key'))).toEqual({ scope: { kind: 'legacy' } })
    expect('error' in (await authenticateWorker(h('legacy-kez')))).toBe(true)
  })

  test('lastUsedAt 이 5분 이내면 갱신하지 않는다', async () => {
    mock.workerToken.findUnique.mockResolvedValue({
      id: 't1',
      spaceId: 'space-a',
      revokedAt: null,
      expiresAt: FUTURE,
      lastUsedAt: new Date(),
    })
    resolveWs.mockResolvedValue(null)
    await authenticateWorker(h('wdw_x'))
    expect(mock.workerToken.update).not.toHaveBeenCalled()
  })
})

describe('범위 검사', () => {
  test('다른 Space 의 spaceId/workspaceId → 403', () => {
    expect(assertWorkerOwns(spaceA, { spaceId: 'space-b' })?.status).toBe(403)
    expect(assertWorkerOwns(spaceA, { workspaceId: 'ws-b' })?.status).toBe(403)
    expect(assertWorkerOwns(spaceA, { spaceId: 'space-a', workspaceId: 'ws-a' })).toBeNull()
    expect(assertWorkerOwns({ kind: 'legacy' }, { spaceId: 'space-b' })).toBeNull()
  })

  test('쿠팡 워크스페이스가 없는 Space 토큰은 워크스페이스 자원에 접근 못 한다', () => {
    const noWs: WorkerScope = { ...spaceA, workspaceId: null }
    expect(assertWorkerOwns(noWs, { workspaceId: 'ws-a' })?.status).toBe(403)
    expect(workerWorkspaceWhere(noWs)).toEqual({ workspaceId: { in: [] } })
  })

  test('폴링 필터: legacy 는 전체, space 는 자기 워크스페이스', () => {
    expect(workerWorkspaceWhere({ kind: 'legacy' })).toEqual({})
    expect(workerWorkspaceWhere(spaceA)).toEqual({ workspaceId: 'ws-a' })
  })

  test('x-workspace-id 가 다른 워크스페이스면 403, 없으면 토큰의 워크스페이스', async () => {
    expect(await resolveWorkerWorkspaceId(spaceA, null)).toEqual({ workspaceId: 'ws-a' })
    const r = await resolveWorkerWorkspaceId(spaceA, 'ws-b')
    expect('error' in r && r.error.status).toBe(403)
  })
})
