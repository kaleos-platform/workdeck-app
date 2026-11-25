/**
 * @jest-environment node
 */
const findInstall = jest.fn()
const findChannel = jest.fn()
const resolveMember = jest.fn()
const findUser = jest.fn()
const listComments = jest.fn()
const addComment = jest.fn()
const writeAuditLog = jest.fn()

jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceSlackChannel: { findFirst: (...a: unknown[]) => findChannel(...a) },
    user: { findUnique: (...a: unknown[]) => findUser(...a) },
  },
}))
jest.mock('@/lib/slack/tenant', () => ({
  findTeamInstallationForSpace: (...a: unknown[]) => findInstall(...a),
}))
jest.mock('@/lib/slack/member-link', () => ({
  resolveSlackMember: (...a: unknown[]) => resolveMember(...a),
}))
jest.mock('@/lib/slack/token-crypto', () => ({ decryptBotToken: () => 'tok' }))
jest.mock('@/lib/slack/notification-target', () => ({ NOTIFICATION_CHANNEL_KIND: 'notifications' }))
jest.mock('@/lib/slack/send-notification', () => ({ OPS_SPACE_ID: 'ops' }))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: (...a: unknown[]) => writeAuditLog(...a) }))
jest.mock('server-only', () => ({}))
jest.mock('@/lib/sentry/api', () => ({
  isSentryApiConfigured: () => true,
  listComments: (...a: unknown[]) => listComments(...a),
  addComment: (...a: unknown[]) => addComment(...a),
}))

process.env.SENTRY_AUTOFIX_NOTE_SECRET = 's'.repeat(40)
import { noteSig } from '../autofix-sig'
import { handleSentryAutofixApprove } from '../slack-approve'

const ID = '20261125-043000-ab12-WEB-1A'
const SHA = '0123456789abcdef'
const input = {
  value: `99|${ID}|${SHA}`,
  teamId: 'T1',
  channelId: 'C1',
  slackUserId: 'U1',
}
const ready = [
  {
    text: `autofix:ready id=${ID} sha=${SHA} files=1 lines=2 verify=ok review=approve`,
    dateCreated: '2026-11-25T00:00:00Z',
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  findInstall.mockResolvedValue({ teamId: 'T1', botToken: 'b', botTokenIv: 'i' })
  findChannel.mockResolvedValue({ channelId: 'C1' })
  resolveMember.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
  findUser.mockResolvedValue({ platformRole: 'OPERATOR' })
  listComments.mockResolvedValue(ready)
  addComment.mockResolvedValue(undefined)
})

describe('handleSentryAutofixApprove', () => {
  it('value 형식이 틀리면 무시', async () => {
    expect(await handleSentryAutofixApprove({ ...input, value: 'x|y|z' })).toBeNull()
    expect(findInstall).not.toHaveBeenCalled()
  })

  it('다른 team 이면 무시', async () => {
    findInstall.mockResolvedValue(null)
    expect(await handleSentryAutofixApprove(input)).toBeNull()
    expect(addComment).not.toHaveBeenCalled()
  })

  it('운영 알림 채널이 아니면 무시', async () => {
    findChannel.mockResolvedValue(null)
    expect(await handleSentryAutofixApprove(input)).toBeNull()
    expect(findChannel).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'ops', kind: 'notifications', channelId: 'C1' } })
    )
    expect(addComment).not.toHaveBeenCalled()
  })

  it('Slack 연결이 없으면 안내', async () => {
    resolveMember.mockResolvedValue(null)
    expect(await handleSentryAutofixApprove(input)).toContain('Slack 연결이 없어')
    expect(addComment).not.toHaveBeenCalled()
  })

  it('운영자가 아니면 거부', async () => {
    findUser.mockResolvedValue({ platformRole: null })
    expect(await handleSentryAutofixApprove(input)).toBe('운영자만 승인할 수 있습니다.')
    expect(addComment).not.toHaveBeenCalled()
  })

  it('id·sha 가 최신 ready 와 다르면 거부', async () => {
    const stale = { ...input, value: `99|${ID}|ffffffffffffffff` }
    expect(await handleSentryAutofixApprove(stale)).toBe(
      '수정안이 바뀌었거나 이미 처리됐습니다. 어드민에서 확인하세요.'
    )
    expect(addComment).not.toHaveBeenCalled()
  })

  it('이미 승인된 상태면 거부', async () => {
    listComments.mockResolvedValue([
      ...ready,
      { text: `autofix:approve id=${ID} sha=${SHA} by=admin`, dateCreated: '2026-11-25T01:00:00Z' },
    ])
    expect(await handleSentryAutofixApprove(input)).toContain('이미 처리됐습니다')
    expect(addComment).not.toHaveBeenCalled()
  })

  it('성공: 감사 로그 후 메모를 정확히 한 번 쓴다', async () => {
    const order: string[] = []
    writeAuditLog.mockImplementation(async () => void order.push('audit'))
    addComment.mockImplementation(async () => void order.push('comment'))
    expect(await handleSentryAutofixApprove(input)).toBe(
      '승인했습니다. 10분 안에 PR이 만들어집니다.'
    )
    expect(order).toEqual(['audit', 'comment'])
    expect(addComment).toHaveBeenCalledTimes(1)
    expect(addComment).toHaveBeenCalledWith(
      '99',
      `autofix:approve id=${ID} sha=${SHA} by=slack sig=${noteSig('approve', '99', ID, SHA)}`
    )
    expect(writeAuditLog).toHaveBeenCalledWith('u1', 'sentryIssue.autofix', 'sentryIssue', '99', {
      action: 'approve',
      id: ID,
      status: 'requested',
      via: 'slack',
    })
  })

  it('메모 쓰기 실패: failed 감사 + 오류 안내', async () => {
    addComment.mockRejectedValue(new Error('boom'))
    expect(await handleSentryAutofixApprove(input)).toContain('쓰지 못했습니다')
    expect(writeAuditLog).toHaveBeenCalledTimes(2)
    expect(writeAuditLog.mock.calls[1][4]).toMatchObject({ status: 'failed' })
  })

  it('서명 키가 없으면 안내만 하고 아무것도 쓰지 않는다', async () => {
    const key = process.env.SENTRY_AUTOFIX_NOTE_SECRET
    delete process.env.SENTRY_AUTOFIX_NOTE_SECRET
    try {
      expect(await handleSentryAutofixApprove(input)).toBe('승인 서명 키가 설정되지 않았습니다')
    } finally {
      process.env.SENTRY_AUTOFIX_NOTE_SECRET = key
    }
    expect(writeAuditLog).not.toHaveBeenCalled()
    expect(addComment).not.toHaveBeenCalled()
  })

  it('검증 실패 ready 는 승인 불가', async () => {
    listComments.mockResolvedValue([
      { ...ready[0], text: ready[0].text.replace('verify=ok', 'verify=fail') },
    ])
    expect(await handleSentryAutofixApprove(input)).toContain('이미 처리됐습니다')
    expect(addComment).not.toHaveBeenCalled()
  })

  it('첫 감사 로그 실패: 안내하고 노트를 쓰지 않는다', async () => {
    writeAuditLog.mockRejectedValueOnce(new Error('db'))
    expect(await handleSentryAutofixApprove(input)).toBe(
      '승인을 기록하지 못했습니다. 잠시 후 다시 시도하세요.'
    )
    expect(addComment).not.toHaveBeenCalled()
  })
})
