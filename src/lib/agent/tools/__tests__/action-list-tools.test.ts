/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({ prisma: { agentPendingAction: { findMany: jest.fn() } } }))

import { prisma } from '@/lib/prisma'
import { makeListActionsTool } from '../action-list-tools'
import type { McpToolContext } from '../types'

const findMany = prisma.agentPendingAction.findMany as jest.Mock
const ctx: McpToolContext = {
  spaceId: 'sp-1',
  actor: { type: 'agent', id: 'ag-1' },
  scopes: ['meta:read'],
  workId: 'wk_1',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}
const tool = makeListActionsTool({
  name: 'meta_ads_list_actions',
  deckKey: 'meta-ads',
  scope: 'meta:read',
  label: '메타 광고',
})
const row = {
  id: 'a1',
  actionType: 'meta-ads.ad.create',
  status: 'EXECUTED',
  summary: '광고 생성',
  payload: { params: { name: 'x', access_token: 'EAAsecret' } },
  result: { id: '120000000001', access_token: 'EAAsecret' },
  error: null,
  workId: 'wk_9',
  actorType: 'agent',
  actorId: 'ag-1',
  createdAt: new Date('2026-10-14T00:00:00Z'),
  expiresAt: new Date('2026-10-17T00:00:00Z'),
  decidedAt: null,
  executedAt: null,
}

beforeEach(() => findMany.mockReset())

it('read 도구이고 선언한 scope를 쓴다', () => {
  expect(tool.mode).toBe('read')
  expect(tool.scope).toBe('meta:read')
  expect(tool.name).toBe('meta_ads_list_actions')
})

it('항상 현재 Space와 덱으로만 찾고 최신순·기본 20건', async () => {
  findMany.mockResolvedValue([])
  await tool.execute(ctx, {})
  const arg = findMany.mock.calls[0][0]
  expect(arg.where).toEqual({ spaceId: 'sp-1', deckKey: 'meta-ads' })
  expect(arg.orderBy).toEqual({ createdAt: 'desc' })
  expect(arg.take).toBe(20)
})

it('status·actionId·workId 필터를 더하되 Space·덱 조건은 덮어쓰지 않는다', async () => {
  findMany.mockResolvedValue([])
  await tool.execute(ctx, { status: 'FAILED', actionId: 'a1', workId: 'wk_9', limit: 5 })
  const arg = findMany.mock.calls[0][0]
  expect(arg.where).toEqual({
    spaceId: 'sp-1',
    deckKey: 'meta-ads',
    status: 'FAILED',
    id: 'a1',
    workId: 'wk_9',
  })
  expect(arg.take).toBe(5)
})

it('결과·제안 내용의 비밀값을 가리고 생성 id는 남긴다', async () => {
  findMany.mockResolvedValue([
    { ...row, summary: 'token=EAAsecret 로 생성', error: 'failed access_token=EAAsecret' },
  ])
  const out = (await tool.execute(ctx, {})) as { actions: Array<Record<string, unknown>> }
  const a = out.actions[0]
  expect(a.result).toEqual({ id: '120000000001', access_token: '[redacted]' })
  expect(JSON.stringify(a.payload)).not.toContain('EAAsecret')
  expect(a.error).toBe('failed access_token=[redacted]')
  expect(a.summary).toBe('token=[redacted] 로 생성')
})

describe('waitSec — 승인·실행이 끝날 때까지 기다린다', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('PENDING → APPROVED → EXECUTED 로 바뀌면 끝난 결과와 waiting:false', async () => {
    findMany
      .mockResolvedValueOnce([{ ...row, status: 'PENDING' }])
      .mockResolvedValueOnce([{ ...row, status: 'APPROVED' }])
      .mockResolvedValueOnce([{ ...row, status: 'EXECUTED' }])
    const p = tool.execute(ctx, { actionId: 'a1', waitSec: 30 })
    await jest.advanceTimersByTimeAsync(6000)
    const out = (await p) as { waiting: boolean; actions: { status: string }[] }
    expect(out.waiting).toBe(false)
    expect(out.actions[0].status).toBe('EXECUTED')
    expect(findMany).toHaveBeenCalledTimes(3)
  })

  it('시간 안에 안 끝나면 waiting:true 로 돌려준다', async () => {
    findMany.mockResolvedValue([{ ...row, status: 'PENDING' }])
    const p = tool.execute(ctx, { actionId: 'a1', waitSec: 7 })
    await jest.advanceTimersByTimeAsync(10000)
    const out = (await p) as { waiting: boolean }
    expect(out.waiting).toBe(true)
    // 3초 간격 → 첫 조회 + 2번 재조회(7초 안)
    expect(findMany).toHaveBeenCalledTimes(3)
  })

  it('actionId 없이 waitSec 만 주면 기다리지 않고 waiting 도 없다', async () => {
    findMany.mockResolvedValue([{ ...row, status: 'PENDING' }])
    const out = (await tool.execute(ctx, { waitSec: 30 })) as Record<string, unknown>
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(out).not.toHaveProperty('waiting')
  })

  it('다른 Space 의 actionId 는 조건에 걸려 빈 결과·즉시 반환', async () => {
    findMany.mockResolvedValue([])
    const out = (await tool.execute(ctx, { actionId: 'other', waitSec: 30 })) as {
      waiting: boolean
      actions: unknown[]
    }
    expect(out).toEqual({ waiting: false, actions: [] })
    expect(findMany.mock.calls[0][0].where).toMatchObject({ spaceId: 'sp-1', id: 'other' })
  })
})
