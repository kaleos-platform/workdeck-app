/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceSecret: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    spaceAgent: { findUnique: jest.fn() },
  },
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
  SecretUnavailableError,
  saveEnvSecret,
  loadEnvSecretsForIssue,
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

const agentFind = prisma.spaceAgent.findUnique as jest.Mock
const AGENT = { spaceId: 'sp1', kind: 'agent', status: 'ACTIVE', scopes: ['secret:write'] }

beforeEach(() => {
  jest.clearAllMocks()
  agentFind.mockResolvedValue(AGENT)
})

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

it('허용 목록에 있는 연동 계정(integration)도 쓸 수 있다(spec §2)', async () => {
  findUnique.mockResolvedValue({ ...ROW, allowedAgentIds: ['i1'] })
  const audit: string[] = []
  const r = await loadSecretForUse('sp1', 'x', { type: 'integration', id: 'i1' }, audit)
  expect(r.value).toBe(KEY)
  await expect(assertSecretUsable('sp1', 'x', { type: 'integration', id: 'i1' })).resolves.toEqual({
    id: 's1',
    revision: 2,
    baseUrl: CONFIG.baseUrl,
  })
  await expect(loadSecretForUse('sp1', 'x', { type: 'integration', id: 'i2' }, [])).rejects.toThrow(
    DENIED
  )
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
    ['actor가 system이다', APPROVAL_ROW, 'sp1', 2, { type: 'system', id: 'a1' }],
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

  const agentCases: Array<[string, Record<string, unknown> | null]> = [
    ['제안한 에이전트가 삭제됐다', null],
    ['제안한 에이전트가 DISABLED', { ...AGENT, status: 'DISABLED' }],
    ['제안한 에이전트가 다른 Space 소속', { ...AGENT, spaceId: 'sp2' }],
    ['제안한 에이전트의 secret:write scope가 회수됐다', { ...AGENT, scopes: ['secret:read'] }],
    ['신원 kind가 actor.type과 다르다', { ...AGENT, kind: 'integration' }],
  ]
  it.each(agentCases)('%s → 거부, 복호화·audit 없음', async (_n, agent) => {
    findUnique.mockResolvedValue(APPROVAL_ROW)
    agentFind.mockResolvedValue(agent)
    const audit: string[] = []
    await expect(loadSecretForApproval('sp1', 's1', 2, actor, audit)).rejects.toThrow(CHANGED)
    expect(agentFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a1' } }))
    expect(decryptField).not.toHaveBeenCalled()
    expect(audit).toEqual([])
  })

  it('허용된 연동 계정(integration) 제안도 실행된다', async () => {
    findUnique.mockResolvedValue({ ...APPROVAL_ROW, allowedAgentIds: ['i1'] })
    agentFind.mockResolvedValue({ ...AGENT, kind: 'integration' })
    const r = await loadSecretForApproval('sp1', 's1', 2, { type: 'integration', id: 'i1' }, [])
    expect(r.value).toBe(KEY)
  })

  it('모두 일치하면 복호화하고 audit에 secret:id를 남긴다', async () => {
    findUnique.mockResolvedValue(APPROVAL_ROW)
    const audit: string[] = []
    const r = await loadSecretForApproval('sp1', 's1', 2, actor, audit)
    expect(r).toEqual({ id: 's1', value: KEY, config: CONFIG })
    expect(audit).toEqual(['secret:s1'])
  })
})

describe('loadEnvSecretsForIssue', () => {
  const NOW = new Date('2026-10-23T00:00:00Z')
  const agent = { type: 'agent', id: 'a1' } as never
  const envRow = (id: string, envName: string, over: Record<string, unknown> = {}) => ({
    id,
    kind: 'ENV',
    revision: 1,
    config: { envName, expiresAt: '2026-12-01T00:00:00.000Z' },
    allowedAgentIds: ['a1'],
    encryptedPayload: 'OPAQUE_CIPHERTEXT',
    iv: 'OPAQUE_IV',
    ...over,
  })
  const rows: Record<string, unknown> = {}
  beforeEach(() => {
    for (const k of Object.keys(rows)) delete rows[k]
    findUnique.mockImplementation(async ({ where }) => rows[where.spaceId_name.name] ?? null)
  })

  it('성공: 이름 순서대로 envName·value, audit에 secret:<id> 각각', async () => {
    rows['b-key'] = envRow('s2', 'B_TOKEN')
    rows['a-key'] = envRow('s1', 'A_TOKEN')
    const audit: string[] = []
    const r = await loadEnvSecretsForIssue('sp1', ['b-key', 'a-key'], agent, audit, NOW)
    expect(r).toEqual([
      { id: 's2', name: 'b-key', envName: 'B_TOKEN', value: KEY },
      { id: 's1', name: 'a-key', envName: 'A_TOKEN', value: KEY },
    ])
    expect(audit).toEqual(['secret:s2', 'secret:s1'])
  })

  it('하나라도 허용 밖이면 SecretUnavailableError(이름 포함), 복호화·audit 없음', async () => {
    rows['a-key'] = envRow('s1', 'A_TOKEN')
    rows['b-key'] = envRow('s2', 'B_TOKEN', { allowedAgentIds: ['other'] })
    const audit: string[] = []
    const err = await loadEnvSecretsForIssue('sp1', ['a-key', 'b-key'], agent, audit, NOW).catch(
      (e) => e
    )
    expect(err).toBeInstanceOf(SecretUnavailableError)
    expect(err.secretName).toBe('b-key')
    expect(err.name).toBe('SecretUnavailableError')
    expect(err.message).toBe('사용할 수 없는 비밀값: b-key')
    expect(decryptField).not.toHaveBeenCalled()
    expect(audit).toEqual([])
  })

  it('없는 이름은 SecretUnavailableError', async () => {
    await expect(
      loadEnvSecretsForIssue('sp1', ['nope-key'], agent, [], NOW)
    ).rejects.toBeInstanceOf(SecretUnavailableError)
  })

  it('만료된 키는 SecretUnavailableError', async () => {
    rows['a-key'] = envRow('s1', 'A_TOKEN', {
      config: { envName: 'A_TOKEN', expiresAt: '2026-10-22T00:00:00.000Z' },
    })
    await expect(loadEnvSecretsForIssue('sp1', ['a-key'], agent, [], NOW)).rejects.toBeInstanceOf(
      SecretUnavailableError
    )
    expect(decryptField).not.toHaveBeenCalled()
  })

  it.each([
    ['파싱 불가', 'not-a-date'],
    ['now와 동일', '2026-10-23T00:00:00.000Z'],
  ])('만료 시각이 %s이면 SecretUnavailableError', async (_l, expiresAt) => {
    rows['a-key'] = envRow('s1', 'A_TOKEN', { config: { envName: 'A_TOKEN', expiresAt } })
    await expect(loadEnvSecretsForIssue('sp1', ['a-key'], agent, [], NOW)).rejects.toBeInstanceOf(
      SecretUnavailableError
    )
    expect(decryptField).not.toHaveBeenCalled()
  })

  it('kind API_KEY 행은 SecretUnavailableError', async () => {
    rows['a-key'] = envRow('s1', 'A_TOKEN', { kind: 'API_KEY' })
    await expect(loadEnvSecretsForIssue('sp1', ['a-key'], agent, [], NOW)).rejects.toBeInstanceOf(
      SecretUnavailableError
    )
  })

  it('integration actor는 SecretUnavailableError', async () => {
    rows['a-key'] = envRow('s1', 'A_TOKEN')
    await expect(
      loadEnvSecretsForIssue('sp1', ['a-key'], { type: 'integration', id: 'a1' } as never, [], NOW)
    ).rejects.toBeInstanceOf(SecretUnavailableError)
    expect(decryptField).not.toHaveBeenCalled()
  })

  it('secret_http용 loadSecretForUse는 kind ENV 행을 거부', async () => {
    findUnique.mockResolvedValue(envRow('s1', 'A_TOKEN'))
    await expect(loadSecretForUse('sp1', 'a-key', agent, [])).rejects.toThrow(DENIED)
    expect(decryptField).not.toHaveBeenCalled()
  })
})

describe('saveEnvSecret', () => {
  it('kind ENV로 암호화 저장, 평문 없음', async () => {
    upsert.mockResolvedValue({ id: 's1', revision: 1 })
    const cfg = {
      envName: 'A_TOKEN',
      scopeNote: 'n',
      expiresAt: '2026-12-01T00:00:00.000Z',
      readOnlyConfirmedById: 'u1',
      readOnlyConfirmedAt: '2026-10-23T00:00:00.000Z',
    }
    await saveEnvSecret('sp1', 'a-key', KEY, cfg, ['a1'], 'u1')
    const args = upsert.mock.calls[0][0]
    expect(args.create).toMatchObject({ kind: 'ENV', config: cfg })
    expect(JSON.stringify(args)).not.toContain('SK_TEST')
  })
})
