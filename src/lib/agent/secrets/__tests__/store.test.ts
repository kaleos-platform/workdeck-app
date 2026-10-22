/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceSecret: { upsert: jest.fn(), findUnique: jest.fn() } },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: jest.fn(() => ({ encrypted: 'OPAQUE_CIPHERTEXT', iv: 'OPAQUE_IV' })),
  decryptField: jest.fn(() => 'SK_TEST_0123456789abcdef'),
}))
import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/crypto/field-crypto'
import { assertSecretUsable, loadSecretForUse, saveApiKeySecret } from '../store'

const KEY = 'SK_TEST_0123456789abcdef'
const CONFIG = {
  baseUrl: 'https://api.example.com',
  auth: { in: 'header' as const, name: 'Authorization', template: 'Bearer {value}' },
  readOps: [],
}
const upsert = prisma.spaceSecret.upsert as jest.Mock
const findUnique = prisma.spaceSecret.findUnique as jest.Mock
const ROW = {
  id: 's1',
  kind: 'API_KEY',
  revision: 2,
  config: CONFIG,
  allowedAgentIds: ['a1'],
  encryptedPayload: 'OPAQUE_CIPHERTEXT',
  iv: 'OPAQUE_IV',
}
const DENIED = '사용할 수 없는 비밀값입니다'

beforeEach(() => jest.clearAllMocks())

it('저장 데이터에 평문 키가 없다', async () => {
  upsert.mockResolvedValue({ id: 's1', revision: 1 })
  await saveApiKeySecret('sp1', 'cafe24-admin', KEY, CONFIG, ['a1'], 'u1')
  const args = upsert.mock.calls[0][0]
  expect(JSON.stringify(args)).not.toContain('SK_TEST')
  expect(args.create).toMatchObject({ encryptedPayload: 'OPAQUE_CIPHERTEXT', iv: 'OPAQUE_IV' })
})

it('교체하면 revision이 +1 되고 lastError가 초기화된다', async () => {
  upsert.mockResolvedValue({ id: 's1', revision: 2 })
  const r = await saveApiKeySecret('sp1', 'cafe24-admin', KEY, CONFIG, ['a1'], 'u1')
  expect(r.revision).toBe(2)
  expect(upsert.mock.calls[0][0].update).toMatchObject({
    revision: { increment: 1 },
    lastError: null,
  })
})

describe('허용 검사는 복호화 전에, 같은 메시지로', () => {
  const cases: Array<[string, unknown, { type: 'agent' | 'user' | 'system'; id: string }]> = [
    ['없는 이름', null, { type: 'agent', id: 'a1' }],
    ['허용 목록 밖 agent', ROW, { type: 'agent', id: 'a2' }],
    ['구성원 user', ROW, { type: 'user', id: 'a1' }],
    ['system actor', ROW, { type: 'system', id: 'a1' }],
    ['kind≠API_KEY', { ...ROW, kind: 'LOGIN' }, { type: 'agent', id: 'a1' }],
  ]
  it.each(cases)('%s', async (_n, row, actor) => {
    findUnique.mockResolvedValue(row)
    const audit: string[] = []
    await expect(loadSecretForUse('sp1', 'x', actor, audit)).rejects.toThrow(DENIED)
    await expect(assertSecretUsable('sp1', 'x', actor)).rejects.toThrow(DENIED)
    expect(decryptField).not.toHaveBeenCalled()
    expect(audit).toEqual([])
  })
})

it('허용된 agent는 복호화되고 audit에 secret:id가 남는다', async () => {
  findUnique.mockResolvedValue(ROW)
  const audit: string[] = []
  const r = await loadSecretForUse('sp1', 'x', { type: 'agent', id: 'a1' }, audit)
  expect(r).toMatchObject({ id: 's1', revision: 2, value: KEY })
  expect(audit).toEqual(['secret:s1'])
  await expect(assertSecretUsable('sp1', 'x', { type: 'agent', id: 'a1' })).resolves.toEqual({
    id: 's1',
    revision: 2,
  })
})
