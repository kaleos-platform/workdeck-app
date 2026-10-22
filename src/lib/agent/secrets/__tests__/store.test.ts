/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceSecret: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() } },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({
  encryptField: jest.fn(() => ({ encrypted: 'OPAQUE_CIPHERTEXT', iv: 'OPAQUE_IV' })),
  decryptField: jest.fn(() => 'SK_TEST_0123456789abcdef'),
}))
import { prisma } from '@/lib/prisma'
import { decryptField } from '@/lib/crypto/field-crypto'
import {
  assertSecretUsable,
  listSecretMeta,
  loadSecretForApproval,
  loadSecretForUse,
  saveApiKeySecret,
} from '../store'

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
    baseUrl: CONFIG.baseUrl,
  })
})

it('listSecretMeta는 암호문·IV를 select하지 않고 결과에 키가 없다', async () => {
  const findMany = prisma.spaceSecret.findMany as jest.Mock
  findMany.mockResolvedValue([
    {
      name: 'x',
      kind: 'API_KEY',
      config: CONFIG,
      allowedAgentIds: ['a1'],
      revision: 1,
      lastUsedAt: null,
      lastError: null,
      updatedAt: new Date(),
    },
  ])
  const out = await listSecretMeta('sp1')
  const { select } = findMany.mock.calls[0][0]
  expect(select).not.toHaveProperty('encryptedPayload')
  expect(select).not.toHaveProperty('iv')
  expect(JSON.stringify(out)).not.toContain('SK_TEST')
  // 교체 대화상자가 미리 채울 수 있도록 비밀이 아닌 config는 돌려준다.
  expect(out[0].config).toEqual(CONFIG)
})

describe('loadSecretForApproval — 승인 실행 시 재검증', () => {
  const CHANGED = '비밀값이 바뀌어 실행하지 않았습니다'
  const actor = { type: 'agent' as const, id: 'a1' }
  const APPROVAL_ROW = { ...ROW, spaceId: 'sp1' }
  const cases: Array<[string, Record<string, unknown> | null, string, number, unknown]> = [
    ['행이 없다', null, 'sp1', 2, actor],
    ['revision이 다르다', APPROVAL_ROW, 'sp1', 1, actor],
    ['원 행위자가 허용 목록에 없다', APPROVAL_ROW, 'sp1', 2, { type: 'agent', id: 'a2' }],
    ['spaceId가 다르다', APPROVAL_ROW, 'sp2', 2, actor],
    ['종류가 API_KEY가 아니다', { ...APPROVAL_ROW, kind: 'ENV' }, 'sp1', 2, actor],
    ['actor가 agent가 아니다', APPROVAL_ROW, 'sp1', 2, { type: 'user', id: 'a1' }],
  ]
  it.each(cases)('%s → 거부, 복호화·audit 없음', async (_n, row, spaceId, revision, who) => {
    findUnique.mockResolvedValue(row)
    const audit: string[] = []
    await expect(
      loadSecretForApproval(spaceId, 's1', revision, who as typeof actor, audit)
    ).rejects.toThrow(CHANGED)
    expect(decryptField).not.toHaveBeenCalled()
    expect(audit).toEqual([])
  })

  it('모두 일치하면 복호화하고 audit에 secret:id를 남긴다', async () => {
    findUnique.mockResolvedValue(APPROVAL_ROW)
    const audit: string[] = []
    const r = await loadSecretForApproval('sp1', 's1', 2, actor, audit)
    expect(r).toEqual({ id: 's1', value: KEY, config: CONFIG })
    expect(audit).toEqual(['secret:s1'])
  })
})
