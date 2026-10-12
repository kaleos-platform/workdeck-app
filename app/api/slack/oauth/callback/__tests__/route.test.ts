/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/domain', () => ({ buildAppUrl: (p: string) => `https://app.test${p}` }))
// jest.mock 팩토리는 mock 접두사 변수만 참조할 수 있다.
let mockReconnect = false
jest.mock('@/lib/slack/state', () => ({
  verifyState: () => ({ spaceId: 'sp-kaleos', userId: 'u-admin', reconnect: mockReconnect }),
}))
jest.mock('@/lib/slack/client', () => ({
  oauthV2Access: jest.fn().mockResolvedValue({
    ok: true,
    access_token: 'xoxb-shared',
    bot_user_id: 'UBOT',
    scope: 'chat:write',
    team: { id: 'T_SHARED', name: 'Shared' },
  }),
}))
jest.mock('@/lib/slack/token-crypto', () => ({
  encryptBotToken: () => ({ token: 'enc', iv: 'v1' }),
}))
jest.mock('@/lib/prisma', () => {
  const p = {
    // 인터랙티브 트랜잭션 — 콜백에 같은 mock을 tx로 넘긴다.
    $transaction: jest.fn(),
    $executeRaw: jest.fn().mockResolvedValue(1),
    slackInstallation: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    spaceSlackChannel: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
    agentPendingAction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    agentConversation: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    spaceMember: { findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  }
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p))
  return { prisma: p }
})

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const p = prisma as unknown as {
  slackInstallation: {
    findUnique: jest.Mock
    findMany: jest.Mock
    upsert: jest.Mock
    updateMany: jest.Mock
  }
  spaceSlackChannel: { deleteMany: jest.Mock }
  agentPendingAction: { updateMany: jest.Mock }
  agentConversation: { deleteMany: jest.Mock }
  spaceMember: { findFirst: jest.Mock; updateMany: jest.Mock }
  $executeRaw: jest.Mock
}
const callback = () =>
  GET(new NextRequest('https://app.test/api/slack/oauth/callback?code=c&state=s'))

beforeEach(() => {
  jest.clearAllMocks()
  mockReconnect = false
  p.slackInstallation.findUnique.mockResolvedValue(null) // 이 Space는 아직 설치 없음
  p.slackInstallation.findMany.mockResolvedValue([{ spaceId: 'sp-aml' }]) // 같은 team을 의식주의가 이미 씀
})

test('이미 다른 team에 설치된 Space → team_changed, 아무것도 저장·삭제하지 않는다', async () => {
  p.slackInstallation.findUnique.mockResolvedValue({ teamId: 'T_OLD' })
  const res = await callback()
  expect(res.headers.get('location')).toBe(
    'https://app.test/settings/integrations?slack=team_changed&spaceId=sp-kaleos'
  )
  expect(p.slackInstallation.upsert).not.toHaveBeenCalled()
  expect(p.spaceSlackChannel.deleteMany).not.toHaveBeenCalled()
})

test('재연결(state.reconnect) → 채널·Slack 승인 연결·대화 기록을 정리하고 새 team으로 저장', async () => {
  mockReconnect = true
  p.slackInstallation.findUnique.mockResolvedValue({ teamId: 'T_OLD' })
  p.spaceMember.findFirst.mockResolvedValue({ id: 'm1' })
  const res = await callback()
  expect(res.headers.get('location')).toBe(
    'https://app.test/settings/integrations?slack=connected&spaceId=sp-kaleos'
  )
  expect(p.spaceSlackChannel.deleteMany).toHaveBeenCalledWith({ where: { spaceId: 'sp-kaleos' } })
  expect(p.agentPendingAction.updateMany).toHaveBeenCalledWith({
    where: { spaceId: 'sp-kaleos', status: 'PENDING', slackChannelId: { not: null } },
    data: { slackChannelId: null, slackMessageTs: null },
  })
  expect(p.agentConversation.deleteMany).toHaveBeenCalledWith({ where: { spaceId: 'sp-kaleos' } })
  // 이전 team의 구성원 Slack ID 연결 해제(새 team에서 다시 확인)
  expect(p.spaceMember.updateMany).toHaveBeenCalledWith({
    where: { spaceId: 'sp-kaleos', slackUserId: { not: null } },
    data: { slackUserId: null },
  })
  // 채널 등록과 같은 Space 설치 lock → (새) team lock 순서로 같은 트랜잭션에서 잡는다
  expect(p.$executeRaw).toHaveBeenCalledTimes(2)
  expect(p.$executeRaw.mock.calls[0].slice(1)).toEqual(['slack-install:sp-kaleos'])
  expect(p.$executeRaw.mock.calls[1].slice(1)).toEqual(['slack-team:T_SHARED'])
  expect(p.slackInstallation.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ update: expect.objectContaining({ teamId: 'T_SHARED' }) })
  )
})

test('판정은 lock 뒤에: Space lock → 설치 조회 → team lock → sibling 조회 → 저장', async () => {
  p.spaceMember.findFirst.mockResolvedValue({ id: 'm1' })
  await callback()
  const [spaceLock, teamLock] = p.$executeRaw.mock.invocationCallOrder
  const existingRead = p.slackInstallation.findUnique.mock.invocationCallOrder[0]
  const siblingRead = p.slackInstallation.findMany.mock.invocationCallOrder[0]
  expect(p.$executeRaw.mock.calls[0].slice(1)).toEqual(['slack-install:sp-kaleos'])
  expect(p.$executeRaw.mock.calls[1].slice(1)).toEqual(['slack-team:T_SHARED'])
  expect(spaceLock).toBeLessThan(existingRead)
  expect(existingRead).toBeLessThan(teamLock)
  expect(teamLock).toBeLessThan(siblingRead)
  expect(siblingRead).toBeLessThan(p.slackInstallation.upsert.mock.invocationCallOrder[0])
})

test('같은 team 재설치는 sibling ADMIN이 아니어도 된다(이 Space의 관리자, 경계 변화 없음)', async () => {
  p.slackInstallation.findUnique.mockResolvedValue({ teamId: 'T_SHARED' })
  p.spaceMember.findFirst.mockResolvedValue(null)
  const res = await callback()
  expect(res.headers.get('location')).toBe(
    'https://app.test/settings/integrations?slack=connected&spaceId=sp-kaleos'
  )
  expect(p.spaceMember.findFirst).not.toHaveBeenCalled()
  expect(p.slackInstallation.upsert).toHaveBeenCalled()
})

test('team_changed 판정은 Space lock 뒤, team lock 전에 끝난다', async () => {
  p.slackInstallation.findUnique.mockResolvedValue({ teamId: 'T_OLD' })
  await callback()
  expect(p.$executeRaw).toHaveBeenCalledTimes(1)
  expect(p.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
    p.slackInstallation.findUnique.mock.invocationCallOrder[0]
  )
})

test('같은 team 재설치(scope 추가)는 정리하지 않는다', async () => {
  p.slackInstallation.findUnique.mockResolvedValue({ teamId: 'T_SHARED' })
  p.spaceMember.findFirst.mockResolvedValue({ id: 'm1' })
  await callback()
  expect(p.spaceSlackChannel.deleteMany).not.toHaveBeenCalled()
  expect(p.spaceMember.updateMany).not.toHaveBeenCalled()
  expect(p.slackInstallation.upsert).toHaveBeenCalled()
})

test('기존 Space의 ADMIN이 아니면 team_conflict, 저장하지 않는다', async () => {
  p.spaceMember.findFirst.mockResolvedValue(null)
  const res = await callback()
  expect(res.headers.get('location')).toBe(
    'https://app.test/settings/integrations?slack=team_conflict&spaceId=sp-kaleos'
  )
  expect(p.spaceMember.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { userId: 'u-admin', spaceId: { in: ['sp-aml'] }, role: { in: ['OWNER', 'ADMIN'] } },
    })
  )
  expect(p.slackInstallation.upsert).not.toHaveBeenCalled()
})

test('Slack에서 취소(denied)해도 검증된 state의 spaceId를 유지한다', async () => {
  const res = await GET(
    new NextRequest('https://app.test/api/slack/oauth/callback?error=access_denied&state=s')
  )
  expect(res.headers.get('location')).toBe(
    'https://app.test/settings/integrations?slack=denied&spaceId=sp-kaleos'
  )
})

test('기존 Space의 ADMIN이면 같은 team에 연결된다 + 같은 team 행 토큰 동기화', async () => {
  p.spaceMember.findFirst.mockResolvedValue({ id: 'm1' })
  const res = await callback()
  expect(res.headers.get('location')).toBe(
    'https://app.test/settings/integrations?slack=connected&spaceId=sp-kaleos'
  )
  expect(p.slackInstallation.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { spaceId: 'sp-kaleos' } })
  )
  expect(p.slackInstallation.updateMany).toHaveBeenCalledWith({
    where: { teamId: 'T_SHARED', spaceId: { not: 'sp-kaleos' } },
    data: {
      teamName: 'Shared',
      botUserId: 'UBOT',
      botToken: 'enc',
      botTokenIv: 'v1',
      scope: 'chat:write',
    },
  })
})
