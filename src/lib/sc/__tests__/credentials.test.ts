/** @jest-environment node */
import crypto from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/crypto/field-crypto'
import {
  readChannelCredential,
  readChannelCredentialSealed,
  upsertChannelCredential,
} from '../credentials'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    channelCredential: { upsert: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  },
}))
const mock = prisma as unknown as {
  channelCredential: { upsert: jest.Mock; findUnique: jest.Mock; updateMany: jest.Mock }
}

const LEGACY = 'c'.repeat(64)
function legacyCbc(plaintext: string) {
  const iv = crypto.randomBytes(16)
  const c = crypto.createCipheriv('aes-256-cbc', Buffer.from(LEGACY, 'hex'), iv)
  return { encrypted: c.update(plaintext, 'utf8', 'hex') + c.final('hex'), iv: iv.toString('hex') }
}

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

test('저장은 channel-credential 용도 v1 으로 한다', async () => {
  await upsertChannelCredential({
    spaceId: 's1',
    channelId: 'ch1',
    kind: 'COOKIE',
    payload: { storageState: '{}' },
  })
  const create = mock.channelCredential.upsert.mock.calls[0][0].create
  expect(create.iv).toBe('v1')
  expect(decryptField('channel-credential', create.encryptedPayload, create.iv)).toBe(
    '{"storageState":"{}"}'
  )
  expect(() => decryptField('pii', create.encryptedPayload, create.iv)).toThrow()
})

test('v0 행을 읽으면 같은 암호문일 때만 v1 으로 조건부 갱신한다', async () => {
  const v0 = legacyCbc('{"accessToken":"t"}')
  mock.channelCredential.findUnique.mockResolvedValue({
    id: 'cred-1',
    encryptedPayload: v0.encrypted,
    iv: v0.iv,
    expiresAt: null,
  })
  mock.channelCredential.updateMany.mockResolvedValue({ count: 1 })

  const read = await readChannelCredential('ch1', 'OAUTH')
  expect(read?.payload).toEqual({ accessToken: 't' })
  const arg = mock.channelCredential.updateMany.mock.calls[0][0]
  expect(arg.where).toEqual({ id: 'cred-1', encryptedPayload: v0.encrypted })
  expect(arg.data.iv).toBe('v1')
})

test('sealed 읽기는 평문을 만들지 않고 암호문을 그대로 돌려준다', async () => {
  mock.channelCredential.findUnique.mockResolvedValue({
    id: 'cred-1',
    encryptedPayload: 'v1:k1:aaa:bbb:ccc',
    iv: 'v1',
    expiresAt: null,
  })
  await expect(readChannelCredentialSealed('ch1', 'COOKIE')).resolves.toEqual({
    encryptedPayload: 'v1:k1:aaa:bbb:ccc',
    iv: 'v1',
    expiresAt: null,
  })
})

describe('지연 재암호화 경계', () => {
  const v0Row = () => {
    const v0 = legacyCbc('{"accessToken":"t"}')
    mock.channelCredential.findUnique.mockResolvedValue({
      id: 'cred-1',
      encryptedPayload: v0.encrypted,
      iv: v0.iv,
      expiresAt: null,
    })
  }

  test('v0 쓰기 기간(4a)에는 갱신하지 않는다', async () => {
    process.env.ENCRYPTION_WRITE_VERSION = 'v0'
    v0Row()
    expect((await readChannelCredential('ch1', 'OAUTH'))?.payload).toEqual({ accessToken: 't' })
    expect(mock.channelCredential.updateMany).not.toHaveBeenCalled()
  })

  test('그 사이 재등록돼 갱신 0건이어도 읽은 값을 돌려준다', async () => {
    v0Row()
    mock.channelCredential.updateMany.mockResolvedValue({ count: 0 })
    expect((await readChannelCredential('ch1', 'OAUTH'))?.payload).toEqual({ accessToken: 't' })
  })

  test('저장이 실패해도 읽기는 성공한다', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    v0Row()
    mock.channelCredential.updateMany.mockRejectedValue(new Error('db down'))
    expect((await readChannelCredential('ch1', 'OAUTH'))?.payload).toEqual({ accessToken: 't' })
  })
})
