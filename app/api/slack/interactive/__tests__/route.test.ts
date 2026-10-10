/** @jest-environment node */
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { approveAndExecute, rejectAction } from '@/lib/agent/actions/execute'
import { postResponseUrl } from '@/lib/slack/client'
import { resolveSlackMember } from '@/lib/slack/member-link'
import { syncSlackDecision } from '@/lib/slack/sync-decision'
import { POST } from '../route'

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
    agentPendingAction: { findUnique: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
  },
}))
jest.mock('@/lib/slack/verify', () => ({ verifySlackSignature: () => true }))
jest.mock('@/lib/slack/client', () => ({ postResponseUrl: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/slack/sync-decision', () => ({ syncSlackDecision: jest.fn() }))
jest.mock('@/lib/slack/token-crypto', () => ({ decryptBotToken: () => 'xoxb-test' }))
jest.mock('@/lib/slack/member-link', () => ({ resolveSlackMember: jest.fn() }))
jest.mock('@/lib/agent/actions/execute', () => ({
  approveAndExecute: jest.fn(),
  rejectAction: jest.fn(),
}))

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
}
const member = resolveSlackMember as jest.Mock
const sync = syncSlackDecision as jest.Mock
const approve = approveAndExecute as jest.Mock
const reject = rejectAction as jest.Mock
const ephemeral = postResponseUrl as jest.Mock

function click(actionIdName = 'agent_action_approve') {
  const payload = {
    type: 'block_actions',
    user: { id: 'U1' },
    team: { id: 'T1' },
    channel: { id: 'C1' },
    response_url: 'https://hooks.slack.test/r',
    actions: [{ action_id: actionIdName, value: 'act-1' }],
  }
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
  return { text: async () => body, headers: new Headers() } as unknown as NextRequest
}

beforeEach(() => {
  jest.clearAllMocks()
  p.agentPendingAction.findUnique.mockResolvedValue({
    id: 'act-1',
    status: 'PENDING',
    spaceId: 'space-1',
    slackChannelId: 'C1',
    actionType: 'x',
    payload: {},
  })
  p.slackInstallation.findUnique.mockResolvedValue({
    spaceId: 'space-1',
    botToken: 'enc',
    botTokenIv: 'v1',
  })
  approve.mockResolvedValue({ ok: true, status: 'EXECUTED', result: null })
  reject.mockResolvedValue({ ok: false, status: 'REJECTED' })
})

test('Slack 연결이 없는 사용자 → 결정 없음 + 안내', async () => {
  member.mockResolvedValue(null)
  await POST(click())
  expect(approve).not.toHaveBeenCalled()
  expect(ephemeral.mock.calls[0][1].text).toContain('Slack 연결')
})

test('승인자는 연결된 구성원의 User.id 로 넘어간다', async () => {
  member.mockResolvedValue({ userId: 'u-admin', role: 'ADMIN' })
  await POST(click())
  expect(member).toHaveBeenCalledWith(
    expect.objectContaining({ spaceId: 'space-1', teamId: 'T1', slackUserId: 'U1' })
  )
  expect(approve).toHaveBeenCalledWith('act-1', 'u-admin')
  expect(sync).toHaveBeenCalledWith('act-1')
})

test('역할 부족(FORBIDDEN) → 안내만, 메시지 동기화 없음', async () => {
  member.mockResolvedValue({ userId: 'u-member', role: 'MEMBER' })
  approve.mockResolvedValue({
    ok: false,
    status: 'FORBIDDEN',
    message: '승인 권한이 없습니다(ADMIN 이상 필요).',
  })
  await POST(click())
  expect(ephemeral.mock.calls[0][1].text).toContain('ADMIN')
  expect(sync).not.toHaveBeenCalled()
})

test('지출 제안을 ADMIN 이 승인(FORBIDDEN) → 지출 제안 안내', async () => {
  member.mockResolvedValue({ userId: 'u-admin', role: 'ADMIN' })
  approve.mockResolvedValue({
    ok: false,
    status: 'FORBIDDEN',
    message:
      '지출 제안은 OWNER(회사 대표 계정)만 승인할 수 있습니다. 워크덱 승인 화면에서 승인하세요.',
  })
  await POST(click())
  expect(ephemeral.mock.calls[0][1].text).toContain('지출 제안')
})

test('거부 → rejectAction(User.id)', async () => {
  member.mockResolvedValue({ userId: 'u-admin', role: 'ADMIN' })
  await POST(click('agent_action_reject'))
  expect(reject).toHaveBeenCalledWith('act-1', 'u-admin')
})

test('다른 team 의 설치 → 조용히 무시(기존 테넌트 가드 유지)', async () => {
  p.slackInstallation.findUnique.mockResolvedValue({
    spaceId: 'space-2',
    botToken: 'e',
    botTokenIv: 'v1',
  })
  await POST(click())
  expect(member).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
})

test('대기 상태가 아닌 액션 → 연결 조회·결정 없이 안내만', async () => {
  p.agentPendingAction.findUnique.mockResolvedValue({
    id: 'act-1',
    status: 'EXECUTED',
    spaceId: 'space-1',
    slackChannelId: 'C1',
    actionType: 'x',
    payload: {},
  })
  await POST(click())
  expect(member).not.toHaveBeenCalled()
  expect(approve).not.toHaveBeenCalled()
  expect(ephemeral.mock.calls[0][1].text).toContain('이미 처리')
})
