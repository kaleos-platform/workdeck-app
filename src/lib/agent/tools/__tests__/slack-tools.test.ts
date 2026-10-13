/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { slackInstallation: { findUnique: jest.fn() }, spaceAgent: { findUnique: jest.fn() } },
}))
jest.mock('@/lib/slack/token-crypto', () => ({ decryptBotToken: jest.fn(() => 'xoxb-test') }))
jest.mock('@/lib/slack/client', () => ({ postMessage: jest.fn() }))
jest.mock('@/lib/slack/tenant', () => ({ isChannelRegisteredToSpace: jest.fn() }))

import { prisma } from '@/lib/prisma'
import { postMessage } from '@/lib/slack/client'
import { isChannelRegisteredToSpace } from '@/lib/slack/tenant'
import { ToolUserError } from '../errors'
import { slackPostTool } from '../slack-tools'
import type { McpToolContext } from '../types'

const p = prisma as unknown as {
  slackInstallation: { findUnique: jest.Mock }
  spaceAgent: { findUnique: jest.Mock }
}
const registered = isChannelRegisteredToSpace as jest.Mock
const post = postMessage as jest.Mock
const ctx: McpToolContext = {
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'ag1' },
  scopes: ['slack:write'],
  workId: 'wk',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}
const INSTALL = { teamId: 'T1', botToken: 'enc', botTokenIv: 'iv' }

describe('slack_post', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    p.spaceAgent.findUnique.mockResolvedValue({ name: '에밀리' })
    p.slackInstallation.findUnique.mockResolvedValue(INSTALL)
    registered.mockResolvedValue(true)
    post.mockResolvedValue({ ok: true, ts: '1.2', channel: 'C1' })
  })

  it('자기 Space 등록 채널이면 Space 설치 토큰으로 게시하고 에이전트 이름을 붙인다', async () => {
    await expect(
      slackPostTool.execute(ctx, { channel: 'C1', text: '완료 <@U1>' })
    ).resolves.toEqual({
      ok: true,
      channel: 'C1',
      ts: '1.2',
    })
    expect(post).toHaveBeenCalledWith('xoxb-test', {
      channel: 'C1',
      text: '[에밀리] 완료 <@U1>',
      thread_ts: undefined,
    })
    expect(p.slackInstallation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { spaceId: 'sp1' } })
    )
    expect(registered).toHaveBeenCalledWith({ teamId: 'T1', channelId: 'C1', spaceId: 'sp1' })
  })

  it('스레드 답글도 등록 채널이면 보낸다', async () => {
    await slackPostTool.execute(ctx, { channel: 'C1', text: 'x', threadTs: '9.9' })
    expect(post).toHaveBeenCalledWith('xoxb-test', expect.objectContaining({ thread_ts: '9.9' }))
  })

  it('에이전트 이름은 mrkdwn 이스케이프한다', async () => {
    p.spaceAgent.findUnique.mockResolvedValue({ name: '<!channel>&봇' })
    await slackPostTool.execute(ctx, { channel: 'C1', text: 'x' })
    expect(post).toHaveBeenCalledWith(
      'xoxb-test',
      expect.objectContaining({ text: '[&lt;!channel&gt;&amp;봇] x' })
    )
  })

  it('Slack이 연결되지 않은 Space는 오류', async () => {
    p.slackInstallation.findUnique.mockResolvedValue(null)
    await expect(slackPostTool.execute(ctx, { channel: 'C1', text: 'x' })).rejects.toThrow(
      '이 Space에 Slack이 연결되지 않았습니다'
    )
    expect(post).not.toHaveBeenCalled()
  })

  // 미등록 채널과 다른 Space가 등록한 채널은 helper에서 모두 false — 둘 다 거부
  it.each(['미등록 채널', '다른 Space 등록 채널'])('%s은 거부하고 보내지 않는다', async () => {
    registered.mockResolvedValue(false)
    const err = (await slackPostTool
      .execute(ctx, { channel: 'C1', text: 'x' })
      .catch((e: Error) => e)) as Error
    expect(err).toBeInstanceOf(ToolUserError)
    expect(err.message).toContain('워크덱 설정에서 이 Space의 Slack 채널로 등록')
    expect(post).not.toHaveBeenCalled()
  })

  it.each([
    'hi <!channel>',
    '<!here>',
    '<!everyone>',
    '<!channel|channel>',
    '<!HERE|@here>',
    '<!Everyone>',
  ])('대량 멘션 %s 은 거부', async (text) => {
    const err = (await slackPostTool
      .execute(ctx, { channel: 'C1', text })
      .catch((e: Error) => e)) as Error
    expect(err).toBeInstanceOf(ToolUserError)
    expect(err.message).toContain('전체 멘션')
    expect(post).not.toHaveBeenCalled()
  })

  it('Slack API 오류 코드를 그대로 알린다(not_in_channel 등)', async () => {
    post.mockResolvedValue({ ok: false, error: 'not_in_channel' })
    const err = (await slackPostTool
      .execute(ctx, { channel: 'C1', text: 'x' })
      .catch((e: Error) => e)) as Error
    expect(err).toBeInstanceOf(ToolUserError)
    expect(err.message).toContain('not_in_channel')
  })
})
