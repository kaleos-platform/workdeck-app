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

const ENV_KEYS = ['ENCRYPTION_WRITE_VERSION', 'VERCEL_ENV', 'ENCRYPTION_KEY', 'ENCRYPTION_KEY_V1']
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})
beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.ENCRYPTION_WRITE_VERSION
  delete process.env.VERCEL_ENV
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

describe('지연 재암호화 경계', () => {
  const v0Setting = () => {
    const iv = crypto.randomBytes(16)
    const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(LEGACY, 'hex'), iv)
    mock.spaceAiSetting.findUnique.mockResolvedValue({
      spaceId: 's1',
      mode: 'BYOK',
      provider: 'ANTHROPIC',
      model: null,
      encryptedApiKey: c.update('sk-test', 'utf8', 'hex') + c.final('hex'),
      apiKeyIv: iv.toString('hex'),
    })
  }

  test('v0 쓰기 기간(4a)에는 갱신하지 않는다', async () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    v0Setting()
    await expect(resolveSpaceAiProvider('s1')).resolves.toMatchObject({ mode: 'BYOK' })
    expect(mock.spaceAiSetting.updateMany).not.toHaveBeenCalled()
  })

  test('그 사이 재등록돼 갱신 0건이어도 공급자를 돌려준다', async () => {
    v0Setting()
    mock.spaceAiSetting.updateMany.mockResolvedValue({ count: 0 })
    await expect(resolveSpaceAiProvider('s1')).resolves.toMatchObject({ mode: 'BYOK' })
  })

  test('저장이 실패해도 읽기는 성공한다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    v0Setting()
    mock.spaceAiSetting.updateMany.mockRejectedValue(new Error('db down'))
    await expect(resolveSpaceAiProvider('s1')).resolves.toMatchObject({ mode: 'BYOK' })
  })
})
