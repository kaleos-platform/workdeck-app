/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}))
jest.mock('../token-crypto', () => ({ decryptBotToken: () => 'xoxb-fake' }))
jest.mock('../client', () => ({ chatUpdate: jest.fn().mockResolvedValue({ ok: true }) }))

import { prisma } from '@/lib/prisma'
import { chatUpdate } from '../client'
import { syncSlackDecision } from '../sync-decision'
import { escapeMrkdwn } from '../mrkdwn'

const p = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
  user: { findUnique: jest.Mock }
}

describe('escapeMrkdwn', () => {
  it('제어 구문을 이스케이프하고 & 는 한 번만 바꾼다', () => {
    expect(escapeMrkdwn('<!channel> & <@U1>')).toBe('&lt;!channel&gt; &amp; &lt;@U1&gt;')
    expect(escapeMrkdwn(escapeMrkdwn('&'))).toBe('&amp;amp;')
  })
})

describe('syncSlackDecision', () => {
  it('요약·오류·결정자 이름의 mrkdwn 제어 문자를 이스케이프한다', async () => {
    p.agentPendingAction.findUnique.mockResolvedValue({
      spaceId: 'sp1',
      summary: '<!here> 예산 변경',
      status: 'FAILED',
      decidedBy: 'user-1',
      decidedAt: new Date('2026-10-12T00:00:00Z'),
      error: '외부 오류 <@U9>',
      slackChannelId: 'C1',
      slackMessageTs: '1.1',
    })
    p.slackInstallation.findUnique.mockResolvedValue({ botToken: 'x', botTokenIv: 'y' })
    p.user.findUnique.mockResolvedValue({ name: '<!channel>', email: 'a@x' })

    await syncSlackDecision('act-1')

    const body = JSON.stringify((chatUpdate as jest.Mock).mock.calls[0])
    expect(body).not.toContain('<!here>')
    expect(body).not.toContain('<!channel>')
    expect(body).not.toContain('<@U9>')
    expect(body).toContain('&lt;!here&gt;')
  })
})
