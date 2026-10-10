/** @jest-environment node */
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { resolveSpaceAiProvider } from '../resolve'

jest.mock('@/lib/prisma', () => ({
  prisma: { spaceAiSetting: { findUnique: jest.fn(), updateMany: jest.fn() } },
}))
const mock = prisma as unknown as {
  spaceAiSetting: { findUnique: jest.Mock; updateMany: jest.Mock }
}

const LEGACY = 'c'.repeat(64)

beforeEach(() => {
  process.env.ENCRYPTION_KEY_V1 = 'a'.repeat(64)
  process.env.ENCRYPTION_KEY = LEGACY
})

test('BYOK v0 키는 읽을 때 ai-key 용도 v1 으로 올라간다', async () => {
  const iv = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(LEGACY, 'hex'), iv)
  const enc = c.update('sk-test', 'utf8', 'hex') + c.final('hex')
  mock.spaceAiSetting.findUnique.mockResolvedValue({
    spaceId: 's1',
    mode: 'BYOK',
    provider: 'ANTHROPIC',
    model: null,
    encryptedApiKey: enc,
    apiKeyIv: iv.toString('hex'),
  })
  mock.spaceAiSetting.updateMany.mockResolvedValue({ count: 1 })

  await resolveSpaceAiProvider('s1')

  const arg = mock.spaceAiSetting.updateMany.mock.calls[0][0]
  expect(arg.where).toEqual({ spaceId: 's1', encryptedApiKey: enc })
  expect(arg.data.apiKeyIv).toBe('v1')
})
