/**
 * @jest-environment node
 */
import { sendDeckNotification, sendSystemNotification } from '../send-notification'

const resolveDeckNotifyEnabled = jest.fn()
const resolveSlackNotificationTarget = jest.fn()
const findManyChannel = jest.fn()
const decryptBotToken = jest.fn()
const postMessage = jest.fn()

jest.mock('../notification-target', () => ({
  NOTIFICATION_CHANNEL_KIND: 'notifications',
  resolveDeckNotifyEnabled: (...a: unknown[]) => resolveDeckNotifyEnabled(...a),
  resolveSlackNotificationTarget: (...a: unknown[]) => resolveSlackNotificationTarget(...a),
}))
jest.mock('../token-crypto', () => ({
  decryptBotToken: (...a: unknown[]) => decryptBotToken(...a),
}))
jest.mock('../client', () => ({
  postMessage: (...a: unknown[]) => postMessage(...a),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceSlackChannel: { findMany: (...a: unknown[]) => findManyChannel(...a) },
  },
}))

const OLD_ENV = { ...process.env }

describe('sendDeckNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.SLACK_BOT_TOKEN
    delete process.env.SLACK_CHANNEL_ID
    decryptBotToken.mockReturnValue('xoxb-decrypted')
    postMessage.mockResolvedValue({ ok: true, channel: 'C1', ts: '1' })
  })
  afterAll(() => {
    process.env = { ...OLD_ENV }
  })

  it('토글 off면 아무것도 발송하지 않고 false', async () => {
    // 레거시 env가 설정돼 있어도 발송 안 됨 — 토글이 authoritative.
    process.env.SLACK_BOT_TOKEN = 'xoxb-legacy'
    process.env.SLACK_CHANNEL_ID = 'C-legacy'
    resolveDeckNotifyEnabled.mockResolvedValue(false)

    const result = await sendDeckNotification({
      workspaceId: 'ws1',
      deckKey: 'coupang-ads',
      blocks: [],
      text: 't',
    })

    expect(result).toBe(false)
    expect(resolveSlackNotificationTarget).not.toHaveBeenCalled()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('채널 미등록이면 레거시 env가 설정돼 있어도 발송하지 않음', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-legacy'
    process.env.SLACK_CHANNEL_ID = 'C-legacy'
    resolveDeckNotifyEnabled.mockResolvedValue(true)
    resolveSlackNotificationTarget.mockResolvedValue(null)

    const result = await sendDeckNotification({
      workspaceId: 'ws1',
      deckKey: 'coupang-ads',
      blocks: [],
      text: 't',
    })

    expect(result).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })

  it('레거시 env가 설정돼 있어도 workdeck 봇으로 1건만 발송(에밀리 이중 발송 회귀)', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-legacy'
    process.env.SLACK_CHANNEL_ID = 'C-legacy'
    resolveDeckNotifyEnabled.mockResolvedValue(true)
    resolveSlackNotificationTarget.mockResolvedValue({
      channelId: 'C-new',
      botToken: 'enc',
      botTokenIv: 'iv',
    })

    const result = await sendDeckNotification({
      workspaceId: 'ws1',
      deckKey: 'coupang-ads',
      blocks: [],
      text: 't',
    })

    expect(result).toBe(true)
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      'xoxb-decrypted',
      expect.objectContaining({ channel: 'C-new' })
    )
  })

  it('예외는 흡수하고 false 반환(알림 실패가 전파되지 않음)', async () => {
    resolveDeckNotifyEnabled.mockRejectedValue(new Error('db down'))

    const result = await sendDeckNotification({
      workspaceId: 'ws1',
      deckKey: 'coupang-ads',
      blocks: [],
      text: 't',
    })

    expect(result).toBe(false)
  })
})

describe('sendSystemNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.SLACK_BOT_TOKEN
    delete process.env.SLACK_CHANNEL_ID
    decryptBotToken.mockReturnValue('xoxb-decrypted')
    postMessage.mockResolvedValue({ ok: true })
  })
  afterAll(() => {
    process.env = { ...OLD_ENV }
  })

  it('등록된 모든 notifications 채널로 발송', async () => {
    findManyChannel.mockResolvedValue([
      { channelId: 'C1', installation: { botToken: 'e1', botTokenIv: 'i1' } },
      { channelId: 'C2', installation: { botToken: 'e2', botTokenIv: 'i2' } },
    ])

    const result = await sendSystemNotification({ blocks: [], text: 't' })

    expect(result).toBe(true)
    expect(postMessage).toHaveBeenCalledTimes(2)
  })

  it('레거시 env가 설정돼 있어도 등록 채널로만 발송(에밀리 이중 발송 회귀)', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-legacy'
    process.env.SLACK_CHANNEL_ID = 'C-legacy'
    findManyChannel.mockResolvedValue([
      { channelId: 'C1', installation: { botToken: 'e1', botTokenIv: 'i1' } },
    ])

    await sendSystemNotification({ blocks: [], text: 't' })

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      'xoxb-decrypted',
      expect.objectContaining({ channel: 'C1' })
    )
  })

  it('등록 채널이 없으면 레거시 env가 있어도 발송하지 않음', async () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-legacy'
    process.env.SLACK_CHANNEL_ID = 'C-legacy'
    findManyChannel.mockResolvedValue([])

    const result = await sendSystemNotification({ blocks: [], text: 't' })

    expect(result).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })
})
