/** @jest-environment node */
// 스윕·하트비트의 Space 토큰 처리 — DB 없이 분기만 본다(실제 격리는 worker-sweep-scope.e2e).
//  - Space 토큰 스윕은 엄격 해석(resolveCoupangWorkspaceForSpaceStrict)으로 공유·모호 연결을 건너뛴다.
//  - CRON_SECRET·레거시 스윕은 기존 해석(resolveCoupangWorkspaceForSpace)을 그대로 쓴다.
//  - Space 토큰 실행은 하트비트·CronRun 에 Space 를 남겨 멈춘 Space 가 전역 기록에 가려지지 않게 한다.
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWorker } from '@/lib/worker-auth'
import {
  resolveCoupangWorkspaceForSpace,
  resolveCoupangWorkspaceForSpaceStrict,
} from '@/lib/inv/resolve-coupang-workspace'
import { GET as salesSync } from '../../../../app/api/cron/coupang-sales-sync/route'
import { GET as inventorySync } from '../../../../app/api/cron/coupang-inventory-sync/route'
import { POST as heartbeat } from '../../../../app/api/worker/heartbeat/route'
import { GET as operationsSummary } from '../../../../app/api/sh/dashboard/operations-summary/route'

jest.mock('@/lib/worker-auth', () => ({
  ...jest.requireActual('@/lib/worker-auth'),
  authenticateWorker: jest.fn(),
}))
jest.mock('@/lib/inv/resolve-coupang-workspace', () => ({
  resolveCoupangWorkspaceForSpace: jest.fn().mockResolvedValue(null),
  resolveCoupangWorkspaceForSpaceStrict: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { findMany: jest.fn() },
    deckInstance: { findUnique: jest.fn() },
    workerHeartbeat: { upsert: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    cronRun: { create: jest.fn() },
    productionRun: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  ...jest.requireActual('@/lib/api-helpers'),
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-a' } }),
}))

const auth = authenticateWorker as jest.Mock
const strict = resolveCoupangWorkspaceForSpaceStrict as jest.Mock
const loose = resolveCoupangWorkspaceForSpace as jest.Mock
const mock = prisma as unknown as {
  invStorageLocation: { findMany: jest.Mock }
  deckInstance: { findUnique: jest.Mock }
  workerHeartbeat: { upsert: jest.Mock; findMany: jest.Mock }
  cronRun: { create: jest.Mock }
}
const SPACE_A = { kind: 'space', tokenId: 't1', spaceId: 'space-a', workspaceId: 'ws-a' }
const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(`http://t${path}`, {
    ...init,
    headers: { 'x-worker-api-key': 'k', ...(init?.headers as Record<string, string>) },
  })
const upsertedServices = () => mock.workerHeartbeat.upsert.mock.calls.map((c) => c[0].where.service)

beforeEach(() => {
  jest.clearAllMocks()
  mock.invStorageLocation.findMany.mockResolvedValue([{ spaceId: 'space-a' }])
  mock.deckInstance.findUnique.mockResolvedValue({ isActive: true })
  mock.workerHeartbeat.upsert.mockResolvedValue({
    service: 's',
    lastPingAt: new Date('2026-10-10T00:00:00Z'),
  })
  mock.cronRun.create.mockResolvedValue({})
})

describe.each([
  ['판매 변환', salesSync, '/api/cron/coupang-sales-sync', 'coupang-sales-sync'],
  ['재고 대조', inventorySync, '/api/cron/coupang-inventory-sync', 'coupang-inventory-sync'],
] as const)('%s', (_name, handler, path, service) => {
  test('Space 토큰: 엄격 해석만 쓰고, 연결이 모호하면 그 Space 를 건너뛴다', async () => {
    auth.mockResolvedValue({ scope: SPACE_A })
    const res = await handler(req(path))
    const body = (await res.json()) as { spaces: Array<{ spaceId: string; status: string }> }
    expect(strict).toHaveBeenCalledWith('space-a')
    expect(loose).not.toHaveBeenCalled()
    expect(body.spaces).toEqual([{ spaceId: 'space-a', status: 'skip:no-workspace-link' }])
  })

  test('레거시 키: 기존 해석을 그대로 쓴다', async () => {
    auth.mockResolvedValue({ scope: { kind: 'legacy' } })
    await handler(req(path))
    expect(loose).toHaveBeenCalledWith('space-a')
    expect(strict).not.toHaveBeenCalled()
  })

  test('Space 토큰: 하트비트에 Space 별 키를 함께 남긴다', async () => {
    auth.mockResolvedValue({ scope: SPACE_A })
    await handler(req(path))
    expect(upsertedServices()).toEqual([service, `${service}:space-a`])
  })

  test('레거시 키: 하트비트는 전역 키 하나', async () => {
    auth.mockResolvedValue({ scope: { kind: 'legacy' } })
    await handler(req(path))
    expect(upsertedServices()).toEqual([service])
  })
})

test('재고 대조 CronRun: Space 토큰 실행은 detail 에 scopeSpaceId 를 남긴다', async () => {
  auth.mockResolvedValue({ scope: SPACE_A })
  await inventorySync(req('/api/cron/coupang-inventory-sync'))
  expect(mock.cronRun.create.mock.calls[0][0].data.detail).toMatchObject({
    scopeSpaceId: 'space-a',
  })
})

test('/api/worker/heartbeat: Space 토큰은 전역 키와 Space 별 키를 함께 갱신한다', async () => {
  auth.mockResolvedValue({ scope: SPACE_A })
  const res = await heartbeat(
    req('/api/worker/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ service: 'inventory-collector' }),
    })
  )
  expect(res.status).toBe(200)
  expect(upsertedServices()).toEqual(['inventory-collector', 'inventory-collector:space-a'])
})

test('/api/worker/heartbeat: 레거시 키는 전역 키 하나', async () => {
  auth.mockResolvedValue({ scope: { kind: 'legacy' } })
  await heartbeat(
    req('/api/worker/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ service: 'inventory-collector' }),
    })
  )
  expect(upsertedServices()).toEqual(['inventory-collector'])
})

test("/api/worker/heartbeat: service 에 ':' 가 있으면 400 — 다른 Space 의 키를 대신 갱신하지 못한다", async () => {
  auth.mockResolvedValue({ scope: SPACE_A })
  const res = await heartbeat(
    req('/api/worker/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ service: 'inventory-collector:space-b' }),
    })
  )
  expect(res.status).toBe(400)
  expect(mock.workerHeartbeat.upsert).not.toHaveBeenCalled()
})

test('운영 요약: 하트비트 다운 목록은 전역 키와 자기 Space 키만 조회한다', async () => {
  await operationsSummary()
  expect(mock.workerHeartbeat.findMany.mock.calls[0][0].where.OR).toEqual([
    { service: { not: { contains: ':' } } },
    { service: { endsWith: ':space-a' } },
  ])
})
