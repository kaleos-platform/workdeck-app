/** @jest-environment node */
// 바로 실행 알림 — 내용(에이전트·요약·결과 링크·권한 부여자·승인 내역), update_draft 이전 내용 링크,
// 실패 알림, 전송 실패 시 notifyError 기록(실행 결과는 건드리지 않음), 알림 토글 무관.
import { prisma } from '@/lib/prisma'
import { postMessage } from '../client'
import { notifyAutoExecuted, resolveApprovalsTarget } from '../notify-auto-executed'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), update: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
    spaceSlackChannel: { findFirst: jest.fn() },
    spaceAgent: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))
jest.mock('../token-crypto', () => ({ decryptBotToken: jest.fn(() => 'xoxb') }))
jest.mock('../client', () => ({ postMessage: jest.fn() }))
jest.mock('@/lib/domain', () => ({ buildAppUrl: (p: string) => `https://app.test${p}` }))

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock; update: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
  spaceSlackChannel: { findFirst: jest.Mock }
  spaceAgent: { findFirst: jest.Mock }
  user: { findUnique: jest.Mock }
}
const post = postMessage as jest.Mock
const row = {
  id: 'a1',
  spaceId: 'sp1',
  actionType: 'seller-hub.reorder.plan.create',
  summary: '발주 계획 생성: 상품 p1',
  status: 'EXECUTED',
  error: null,
  beforeState: null,
  actorType: 'agent',
  actorId: 'ag1',
  decidedBy: 'admin1',
}

beforeEach(() => {
  jest.clearAllMocks()
  p.agentPendingAction.findUnique.mockResolvedValue(row)
  p.agentPendingAction.update.mockResolvedValue({})
  p.slackInstallation.findUnique.mockResolvedValue({ botToken: 'e', botTokenIv: 'i' })
  p.spaceSlackChannel.findFirst.mockResolvedValue({ channelId: 'CAPPROVE' })
  p.spaceAgent.findFirst.mockResolvedValue({ name: '에밀리' })
  p.user.findUnique.mockResolvedValue({ name: '에디', email: 'e@x' })
  post.mockResolvedValue({ ok: true, ts: '1.1', channel: 'CAPPROVE' })
})

test('승인 채널로 에이전트·요약·결과 링크·권한 부여자·승인 내역 링크를 보낸다', async () => {
  await notifyAutoExecuted('a1', { resultUrl: 'https://app.test/plans/pl1' })
  expect(post).toHaveBeenCalledTimes(1)
  const [, args] = post.mock.calls[0]
  expect(args.channel).toBe('CAPPROVE')
  expect(args.text).toContain('🤖 *에밀리* 실행: 발주 계획 생성: 상품 p1')
  expect(args.text).toContain('<https://app.test/plans/pl1|결과 보기>')
  expect(args.text).toContain('권한 부여: 에디')
  expect(args.text).toContain('<https://app.test/approvals?spaceId=sp1&action=a1|승인 내역>')
  expect(args.text).not.toContain('이전 내용 보기')
  expect(p.agentPendingAction.update).not.toHaveBeenCalled()
})

test('update_draft 는 이전 내용 보기 링크(승인 내역 상세)를 더한다', async () => {
  p.agentPendingAction.findUnique.mockResolvedValue({
    ...row,
    actionType: 'recruiting.posting.update_draft',
    beforeState: { title: '이전 제목' },
  })
  await notifyAutoExecuted('a1', { resultUrl: 'https://app.test/edit' })
  expect(post.mock.calls[0][1].text).toContain(
    '<https://app.test/approvals?spaceId=sp1&action=a1|이전 내용 보기>'
  )
})

test('연동 계정 실행은 「실행 구성원」으로 표기한다', async () => {
  p.agentPendingAction.findUnique.mockResolvedValue({ ...row, actorType: 'integration' })
  await notifyAutoExecuted('a1')
  expect(post.mock.calls[0][1].text).toContain('실행 구성원: 에디')
})

test('FAILED 도 알림 — 오류 문구 포함', async () => {
  p.agentPendingAction.findUnique.mockResolvedValue({
    ...row,
    status: 'FAILED',
    error: '상품 없음',
  })
  await notifyAutoExecuted('a1')
  const text = post.mock.calls[0][1].text
  expect(text).toContain('⚠️ *에밀리* 실행 실패')
  expect(text).toContain('상품 없음')
})

test('이름·요약의 mrkdwn 제어 문자는 이스케이프한다', async () => {
  p.spaceAgent.findFirst.mockResolvedValue({ name: '<!channel>' })
  await notifyAutoExecuted('a1')
  expect(post.mock.calls[0][1].text).toContain('&lt;!channel&gt;')
})

test('Slack 전송 실패(ok:false) → notifyError 기록, throw 없음', async () => {
  post.mockResolvedValue({ ok: false, error: 'channel_not_found' })
  await expect(notifyAutoExecuted('a1')).resolves.toBeUndefined()
  expect(p.agentPendingAction.update).toHaveBeenCalledWith({
    where: { id: 'a1' },
    data: { notifyError: expect.stringContaining('channel_not_found') },
  })
})

test('전송 중 예외도 notifyError 기록, throw 없음, status 는 건드리지 않는다', async () => {
  post.mockRejectedValue(new Error('network down'))
  await expect(notifyAutoExecuted('a1')).resolves.toBeUndefined()
  const data = p.agentPendingAction.update.mock.calls[0][0].data
  expect(data).toEqual({ notifyError: expect.stringContaining('network down') })
})

test('승인 채널이 없으면 보내지 않고 notifyError 에 남긴다', async () => {
  p.spaceSlackChannel.findFirst.mockResolvedValue(null)
  await notifyAutoExecuted('a1')
  expect(post).not.toHaveBeenCalled()
  expect(p.agentPendingAction.update.mock.calls[0][0].data.notifyError).toContain('채널')
})

test('deck 알림 토글 조회 없이 승인 채널 설치·채널만 본다', async () => {
  await notifyAutoExecuted('a1')
  expect(p.spaceSlackChannel.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { spaceId: 'sp1', kind: 'approvals' } })
  )
})

describe('resolveApprovalsTarget', () => {
  it('설치 + 승인 채널이 모두 있어야 대상을 돌려준다', async () => {
    await expect(resolveApprovalsTarget('sp1')).resolves.toMatchObject({ channelId: 'CAPPROVE' })
    p.slackInstallation.findUnique.mockResolvedValue(null)
    await expect(resolveApprovalsTarget('sp1')).resolves.toBeNull()
    p.slackInstallation.findUnique.mockResolvedValue({ botToken: 'e', botTokenIv: 'i' })
    p.spaceSlackChannel.findFirst.mockResolvedValue(null)
    await expect(resolveApprovalsTarget('sp1')).resolves.toBeNull()
  })
})
