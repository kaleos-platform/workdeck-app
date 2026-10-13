/**
 * @jest-environment node
 *
 * 두 Space(의식주의·Kaleos)의 ADMIN인 상원 — 실제 라우트 핸들러 + 실제 resolveRequestedSpaceContext.
 * getUser·prisma·외부 모듈만 mock한다. 선택 없음 → 400·쓰기 없음, Kaleos 선택 → Kaleos로 저장·조회.
 */
import { NextRequest } from 'next/server'

jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn(async () => ({ id: 'u-sangwon' })) }))
jest.mock('@/lib/slack/state', () => ({ signState: jest.fn(() => 'signed-state') }))
jest.mock('@/lib/slack/tenant', () => ({ registerSpaceChannel: jest.fn() }))
jest.mock('@/lib/agent/actions/execute', () => ({ expirePendingActions: jest.fn() }))
jest.mock('@/lib/agent/actions/actor-label', () => ({
  describeActors: jest.fn(async (rows: unknown[]) => rows.map(() => '라벨')),
}))
jest.mock('@/lib/agent/actions/create', () => ({
  createPendingAction: jest.fn(async () => ({ status: 'pending_approval', actionId: 'a1' })),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceMember: { findMany: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
    agentPendingAction: { findMany: jest.fn() },
    spaceAgentSetting: { upsert: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { signState } from '@/lib/slack/state'
import { registerSpaceChannel } from '@/lib/slack/tenant'
import { createPendingAction } from '@/lib/agent/actions/create'
import { GET as install } from '../slack/oauth/install/route'
import { POST as postChannel } from '../slack/channels/route'
import { PATCH as patchSettings } from '../agent/settings/route'
import { GET as listActions, POST as createAction } from '../agent/actions/route'

const p = prisma as unknown as {
  spaceMember: { findMany: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
  agentPendingAction: { findMany: jest.Mock }
  spaceAgentSetting: { upsert: jest.Mock }
}
const req = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://app.test${path}`, {
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.SLACK_CLIENT_ID = 'cid'
  p.spaceMember.findMany.mockResolvedValue([
    { role: 'ADMIN', space: { id: 'sp-aml', name: '의식주의' } },
    { role: 'ADMIN', space: { id: 'sp-kaleos', name: 'Kaleos' } },
  ])
  p.slackInstallation.findUnique.mockResolvedValue({ spaceId: 'sp-kaleos', teamId: 'T1' })
  p.agentPendingAction.findMany.mockResolvedValue([])
  p.spaceAgentSetting.upsert.mockResolvedValue({ isActive: true })
  ;(registerSpaceChannel as jest.Mock).mockResolvedValue({
    ok: true,
    channel: { id: 'c', channelId: 'CK', channelName: null, kind: 'approvals' },
  })
})

describe('Slack 설치', () => {
  it('선택 없음 → 400 SPACE_REQUIRED, state를 만들지 않는다', async () => {
    const res = await install(req('/api/slack/oauth/install'))
    expect(res.status).toBe(400)
    expect(signState).not.toHaveBeenCalled()
  })
  it('Kaleos 선택 → state의 spaceId가 Kaleos', async () => {
    const res = await install(req('/api/slack/oauth/install?spaceId=sp-kaleos'))
    expect(res.status).toBe(307)
    expect(signState).toHaveBeenCalledWith({
      spaceId: 'sp-kaleos',
      userId: 'u-sangwon',
      reconnect: false,
    })
  })
  it('구성원이 아닌 Space → 403', async () => {
    expect((await install(req('/api/slack/oauth/install?spaceId=sp-x'))).status).toBe(403)
  })
})

describe('채널 등록', () => {
  it('선택 없음 → 400, 등록하지 않는다', async () => {
    const res = await postChannel(
      req('/api/slack/channels', { method: 'POST', body: { channelId: 'CK', kind: 'approvals' } })
    )
    expect(res.status).toBe(400)
    expect(registerSpaceChannel).not.toHaveBeenCalled()
  })
  it('Kaleos 선택 → Kaleos 설치·Kaleos Space로 등록', async () => {
    const res = await postChannel(
      req('/api/slack/channels?spaceId=sp-kaleos', {
        method: 'POST',
        body: { channelId: 'CK', kind: 'approvals' },
      })
    )
    expect(res.status).toBe(200)
    // 설치 확인은 Task 9a 이후 registerSpaceChannel이 lock 안에서 한다 — 그 spaceId로 검증한다.
    expect(registerSpaceChannel).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp-kaleos' })
    )
  })
})

describe('에이전트 설정', () => {
  it('Kaleos 선택 → Kaleos 토글만 바꾼다', async () => {
    const res = await patchSettings(
      req('/api/agent/settings?spaceId=sp-kaleos', {
        method: 'PATCH',
        body: { agentActive: false },
      })
    )
    expect(res.status).toBe(200)
    expect(p.spaceAgentSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'sp-kaleos' } })
    )
  })
})

describe('승인 목록', () => {
  it('선택 없음 → 400', async () => {
    expect((await listActions(req('/api/agent/actions?status=PENDING'))).status).toBe(400)
    expect(p.agentPendingAction.findMany).not.toHaveBeenCalled()
  })
  it('Kaleos 선택 → Kaleos 액션만 조회하고 그 Space의 역할을 돌려준다', async () => {
    const res = await listActions(req('/api/agent/actions?status=PENDING&spaceId=sp-kaleos'))
    expect(res.status).toBe(200)
    expect(p.agentPendingAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ spaceId: 'sp-kaleos' }) })
    )
    await expect(res.json()).resolves.toMatchObject({ role: 'ADMIN' })
  })
  it('세션 POST: body.spaceId=Kaleos → Kaleos에 생성, 구성원 아닌 Space → 403', async () => {
    await createAction(
      req('/api/agent/actions', {
        method: 'POST',
        body: { spaceId: 'sp-kaleos', actionType: 'x', params: {}, summary: 's' },
      })
    )
    expect(createPendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp-kaleos' })
    )
    const res = await createAction(
      req('/api/agent/actions', {
        method: 'POST',
        body: { spaceId: 'sp-x', actionType: 'x', params: {}, summary: 's' },
      })
    )
    expect(res.status).toBe(403)
  })
})
