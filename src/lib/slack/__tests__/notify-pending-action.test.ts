// @jest-environment node
import { notifyPendingAction } from '../notify-pending-action'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    agentPendingAction: { findUnique: jest.fn(), update: jest.fn() },
    slackInstallation: { findUnique: jest.fn() },
    spaceSlackChannel: { findUnique: jest.fn() },
  },
}))

const mockPrisma = prisma as unknown as {
  agentPendingAction: { findUnique: jest.Mock; update: jest.Mock }
  slackInstallation: { findUnique: jest.Mock }
  spaceSlackChannel: { findUnique: jest.Mock }
}

const baseAction = {
  id: 'act-1',
  spaceId: 'space-1',
  deckKey: 'finance',
  actionType: 'finance.transaction.reclassify',
  summary: '거래 재분류',
  requestedBy: 'user-1',
  expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
}

describe('notifyPendingAction — 실패 흡수', () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.ENCRYPTION_KEY = '0'.repeat(64) // 32바이트 hex
  })
  afterAll(() => {
    global.fetch = originalFetch
  })

  test('설치 없음 → fetch 호출 없이 조용히 반환(throw 아님)', async () => {
    mockPrisma.agentPendingAction.findUnique.mockResolvedValue(baseAction)
    mockPrisma.slackInstallation.findUnique.mockResolvedValue(null)
    const fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(notifyPendingAction('act-1')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('Slack fetch 실패 → throw하지 않음', async () => {
    mockPrisma.agentPendingAction.findUnique.mockResolvedValue(baseAction)
    mockPrisma.slackInstallation.findUnique.mockResolvedValue({
      // 유효한 AES-256-CBC 암호문이 아니어도, fetch가 먼저 reject되므로 복호화까지 안 감.
      // 안전하게 실제 암호화 대신 복호화 성공을 보장하려면 실암호문이 필요하므로
      // 여기서는 fetch reject 경로만 검증한다(복호화는 token-crypto 유닛에서 커버).
      botToken: encryptForTest('xoxb-fake'),
      botTokenIv: TEST_IV,
    })
    mockPrisma.spaceSlackChannel.findUnique.mockResolvedValue({ channelId: 'C123' })

    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch

    await expect(notifyPendingAction('act-1')).resolves.toBeUndefined()
    expect(mockPrisma.agentPendingAction.update).not.toHaveBeenCalled()
  })

  test('액션 없음 → 조용히 반환', async () => {
    mockPrisma.agentPendingAction.findUnique.mockResolvedValue(null)
    await expect(notifyPendingAction('missing')).resolves.toBeUndefined()
    expect(mockPrisma.slackInstallation.findUnique).not.toHaveBeenCalled()
  })
})

// ─── 테스트용 실제 AES-256-CBC 암호화 (복호화가 성공하도록) ───
import crypto from 'node:crypto'
const TEST_IV = '00000000000000000000000000000000'
function encryptForTest(plaintext: string): string {
  const key = Buffer.from('0'.repeat(64), 'hex')
  const cipher = crypto.createCipheriv('aes-256-cbc', key, Buffer.from(TEST_IV, 'hex'))
  return cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex')
}
