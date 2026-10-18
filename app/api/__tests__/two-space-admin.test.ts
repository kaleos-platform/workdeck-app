/**
 * @jest-environment node
 *
 * 두 Space(A·B)의 ADMIN인 사용자 — 실제 라우트 핸들러 + 실제 resolveRequestedSpaceContext.
 * getUser·prisma·외부 모듈만 mock한다. 선택 없음 → 현재 Space(A), B 선택 → B로 저장·조회.
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
jest.mock('@/lib/spaces/current-space', () => ({ resolveCurrentMembership: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    space: { findUnique: jest.fn(async () => ({ approvalLimitKrw: null })) },
    slackInstallation: { findUnique: jest.fn() },
    agentPendingAction: { findMany: jest.fn() },
    spaceAgentSetting: { upsert: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { resolveCurrentMembership } from '@/lib/spaces/current-space'
import { signState } from '@/lib/slack/state'
import { registerSpaceChannel } from '@/lib/slack/tenant'
import { createPendingAction } from '@/lib/agent/actions/create'
import { GET as install } from '../slack/oauth/install/route'
import { POST as postChannel } from '../slack/channels/route'
import { PATCH as patchSettings } from '../agent/settings/route'
import { GET as listActions, POST as createAction } from '../agent/actions/route'

const p = prisma as unknown as {
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
  const memberships = [
    { role: 'ADMIN', space: { id: 'sp-a', name: 'Space A' } },
    { role: 'ADMIN', space: { id: 'sp-b', name: 'Space B' } },
  ]
  // 실제 해석기와 같은 계약: 명시 Space → 구성원이면 그것, 아니면 forbidden / 없으면 현재 Space(기본 A)
  ;(resolveCurrentMembership as jest.Mock).mockImplementation(
    async (_uid: string, requested?: string | null) =>
      requested
        ? (memberships.find((m) => m.space.id === requested) ?? { forbidden: true })
        : memberships[0]
  )
  p.slackInstallation.findUnique.mockResolvedValue({ spaceId: 'sp-b', teamId: 'T1' })
  p.agentPendingAction.findMany.mockResolvedValue([])
  p.spaceAgentSetting.upsert.mockResolvedValue({ isActive: true })
  ;(registerSpaceChannel as jest.Mock).mockResolvedValue({
    ok: true,
    channel: { id: 'c', channelId: 'CK', channelName: null, kind: 'approvals' },
  })
})

describe('Slack 설치', () => {
  it('선택 없음 → 현재 Space(A)로 진행, SPACE_REQUIRED 없음', async () => {
    const res = await install(req('/api/slack/oauth/install'))
    expect(res.status).toBe(307)
    expect(signState).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'sp-a' }))
  })
  it('B 선택 → state의 spaceId가 B', async () => {
    const res = await install(req('/api/slack/oauth/install?spaceId=sp-b'))
    expect(res.status).toBe(307)
    expect(signState).toHaveBeenCalledWith({
      spaceId: 'sp-b',
      userId: 'u-sangwon',
      reconnect: false,
    })
  })
  it('구성원이 아닌 Space → 403', async () => {
    expect((await install(req('/api/slack/oauth/install?spaceId=sp-x'))).status).toBe(403)
  })
})

describe('채널 등록', () => {
  it('선택 없음 → 현재 Space(A)로 등록', async () => {
    await postChannel(
      req('/api/slack/channels', { method: 'POST', body: { channelId: 'CK', kind: 'approvals' } })
    )
    expect(registerSpaceChannel).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'sp-a' }))
  })
  it('B 선택 → B 설치·B Space로 등록', async () => {
    const res = await postChannel(
      req('/api/slack/channels?spaceId=sp-b', {
        method: 'POST',
        body: { channelId: 'CK', kind: 'approvals' },
      })
    )
    expect(res.status).toBe(200)
    // 설치 확인은 Task 9a 이후 registerSpaceChannel이 lock 안에서 한다 — 그 spaceId로 검증한다.
    expect(registerSpaceChannel).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'sp-b' }))
  })
})

describe('에이전트 설정', () => {
  it('B 선택 → B 토글만 바꾼다', async () => {
    const res = await patchSettings(
      req('/api/agent/settings?spaceId=sp-b', {
        method: 'PATCH',
        body: { agentActive: false },
      })
    )
    expect(res.status).toBe(200)
    expect(p.spaceAgentSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'sp-b' } })
    )
  })
})

describe('승인 목록', () => {
  it('선택 없음 → 현재 Space(A) 액션 조회', async () => {
    expect((await listActions(req('/api/agent/actions?status=PENDING'))).status).toBe(200)
    expect(p.agentPendingAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ spaceId: 'sp-a' }) })
    )
  })
  it('B 선택 → B 액션만 조회하고 그 Space의 역할을 돌려준다', async () => {
    const res = await listActions(req('/api/agent/actions?status=PENDING&spaceId=sp-b'))
    expect(res.status).toBe(200)
    expect(p.agentPendingAction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ spaceId: 'sp-b' }) })
    )
    await expect(res.json()).resolves.toMatchObject({ role: 'ADMIN' })
  })
  it('세션 POST: body.spaceId=B → B에 생성, 구성원 아닌 Space → 403', async () => {
    await createAction(
      req('/api/agent/actions', {
        method: 'POST',
        body: { spaceId: 'sp-b', actionType: 'x', params: {}, summary: 's' },
      })
    )
    expect(createPendingAction).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'sp-b' }))
    const res = await createAction(
      req('/api/agent/actions', {
        method: 'POST',
        body: { spaceId: 'sp-x', actionType: 'x', params: {}, summary: 's' },
      })
    )
    expect(res.status).toBe(403)
  })
})
