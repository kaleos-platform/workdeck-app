/** @jest-environment node */
import { NextRequest } from 'next/server'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceAgentSetting: { findUnique: jest.fn() },
    toolAuditLog: { count: jest.fn() },
  },
}))
jest.mock('@/lib/crypto/field-crypto', () => ({ encryptField: jest.fn(), decryptField: jest.fn() }))
jest.mock('@/lib/agent/identity/agent-token', () => ({
  AGENT_TOKEN_PREFIX: 'wdk_agt_',
  verifyAgentToken: jest.fn(),
}))
jest.mock('@/lib/agent/audit', () => ({
  AUDIT_UNAVAILABLE: '감사 기록을 남길 수 없어 실행하지 않았습니다',
  startToolAudit: jest.fn(async () => 'audit1'),
  finishToolAudit: jest.fn(async () => undefined),
}))
jest.mock('@/lib/agent/secrets/store', () => ({
  ...jest.requireActual('@/lib/agent/secrets/store'),
  loadEnvSecretsForIssue: jest.fn(),
  recordSecretUsed: jest.fn(async () => undefined),
}))

import { prisma } from '@/lib/prisma'
import { verifyAgentToken } from '@/lib/agent/identity/agent-token'
import { startToolAudit, finishToolAudit } from '@/lib/agent/audit'
import {
  loadEnvSecretsForIssue,
  recordSecretUsed,
  SecretUnavailableError,
  EnvNameConflictError,
} from '@/lib/agent/secrets/store'
import { POST } from '../route'

const KEY = 'SK_TEST_0123456789abcdef'
const TOKEN = 'wdk_agt_abcdefghijklmnopqrst.' + 'x'.repeat(43)
const AGENT = { spaceId: 'sp1', actor: { type: 'agent', id: 'ag1' }, scopes: ['secret:env'] }

const verify = verifyAgentToken as jest.Mock
const setting = prisma.spaceAgentSetting.findUnique as jest.Mock
const count = prisma.toolAuditLog.count as jest.Mock
const load = loadEnvSecretsForIssue as jest.Mock

const req = (body: unknown = { secrets: ['a-key', 'b-key'] }, auth: string | null = TOKEN) =>
  new NextRequest('http://t/api/secrets/env', {
    method: 'POST',
    headers: auth === null ? {} : { authorization: `Bearer ${auth}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  verify.mockResolvedValue(AGENT)
  setting.mockResolvedValue({ envSecretsEnabled: true })
  count.mockResolvedValue(0)
  load.mockImplementation(async (_s, _n, _a, audit: string[]) => {
    audit.push('secret:s1', 'secret:s2')
    return [
      { id: 's1', name: 'a-key', envName: 'A_TOKEN', value: KEY },
      { id: 's2', name: 'b-key', envName: 'B_TOKEN', value: KEY },
    ]
  })
})

it('Authorization 없거나 wdk_agt_ 아닌 토큰 401', async () => {
  for (const auth of [null, 'eyJhbGciOi.jwt.like', '']) {
    const res = await POST(req(undefined, auth))
    expect(res.status).toBe(401)
  }
  expect(verify).not.toHaveBeenCalled()
  verify.mockResolvedValue(null)
  expect((await POST(req())).status).toBe(401)
  expect(load).not.toHaveBeenCalled()
})

it('integration principal 403', async () => {
  verify.mockResolvedValue({ ...AGENT, actor: { type: 'integration', id: 'i1' } })
  expect((await POST(req())).status).toBe(403)
  expect(load).not.toHaveBeenCalled()
})

it('secret:env 없는 토큰 403', async () => {
  verify.mockResolvedValue({ ...AGENT, scopes: ['secret:read'] })
  expect((await POST(req())).status).toBe(403)
  expect(load).not.toHaveBeenCalled()
})

it('envSecretsEnabled 행 없음 → 403', async () => {
  setting.mockResolvedValue(null)
  expect((await POST(req())).status).toBe(403)
  expect(setting).toHaveBeenCalledWith(expect.objectContaining({ where: { spaceId: 'sp1' } }))
  expect(startToolAudit).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it.each([
  ['배열 아님', { secrets: 'a-key' }],
  ['빈 배열', { secrets: [] }],
  ['11개', { secrets: Array.from({ length: 11 }, (_, i) => `k-${i}`) }],
  ['중복 이름', { secrets: ['a-key', 'a-key'] }],
  ['이름 형식', { secrets: ['A_KEY'] }],
  ['JSON 아님', 'not json'],
])('본문 오류(%s) 400', async (_l, body) => {
  expect((await POST(req(body))).status).toBe(400)
  expect(startToolAudit).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it('한 이름이라도 SecretUnavailableError면 403, 응답에 env 키 없음, 감사 finish error', async () => {
  load.mockRejectedValue(new SecretUnavailableError('b-key'))
  const res = await POST(req())
  expect(res.status).toBe(403)
  const body = await res.json()
  expect(body).not.toHaveProperty('env')
  expect(body.message).toBe('사용할 수 없는 비밀값: b-key')
  expect(finishToolAudit).toHaveBeenCalledWith(
    'audit1',
    expect.objectContaining({ outcome: 'error', error: 'unavailable:b-key' })
  )
  expect(recordSecretUsed).not.toHaveBeenCalled()
})

it('두 비밀값의 envName이 같으면 400, 값 없음', async () => {
  load.mockRejectedValue(new EnvNameConflictError('A_TOKEN'))
  const res = await POST(req())
  expect(res.status).toBe(400)
  const text = await res.text()
  expect(text).not.toContain(KEY)
  expect(JSON.parse(text)).not.toHaveProperty('env')
  expect(finishToolAudit).toHaveBeenCalledWith(
    'audit1',
    expect.objectContaining({ outcome: 'error', error: 'env_name_conflict' })
  )
})

it('감사 시작 실패 503, loadEnvSecretsForIssue 호출 안 됨', async () => {
  ;(startToolAudit as jest.Mock).mockRejectedValueOnce(new Error('db down'))
  const res = await POST(req())
  expect(res.status).toBe(503)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect(load).not.toHaveBeenCalled()
})

it('예상 못한 오류는 500, 감사 finish error, 값 없음', async () => {
  load.mockRejectedValue(new Error('decrypt failed'))
  const res = await POST(req())
  expect(res.status).toBe(500)
  expect(await res.text()).not.toContain(KEY)
  expect(finishToolAudit).toHaveBeenCalledWith(
    'audit1',
    expect.objectContaining({ outcome: 'error', error: 'issue_failed' })
  )
})

it('감사 전 DB 오류(토큰·설정 조회)는 401이 아니라 500', async () => {
  verify.mockRejectedValueOnce(new Error('db down'))
  expect((await POST(req())).status).toBe(500)
  setting.mockRejectedValueOnce(new Error('db down'))
  expect((await POST(req())).status).toBe(500)
  count.mockRejectedValueOnce(new Error('db down'))
  expect((await POST(req())).status).toBe(500)
  expect(load).not.toHaveBeenCalled()
})

it('성공: env 맵, no-store, decryptedCredentialIds에 secret:<id>, recordSecretUsed', async () => {
  const res = await POST(req())
  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect(await res.json()).toEqual({ env: { A_TOKEN: KEY, B_TOKEN: KEY } })
  expect(startToolAudit).toHaveBeenCalledWith({
    spaceId: 'sp1',
    workId: expect.any(String),
    actor: { type: 'agent', id: 'ag1' },
    requesterUserId: null,
    tool: 'secret_env_issue',
    args: { secrets: ['a-key', 'b-key'] },
  })
  expect(load).toHaveBeenCalledWith(
    'sp1',
    ['a-key', 'b-key'],
    { type: 'agent', id: 'ag1' },
    expect.any(Array)
  )
  expect(finishToolAudit).toHaveBeenCalledWith(
    'audit1',
    expect.objectContaining({
      outcome: 'ok',
      decryptedCredentialIds: ['secret:s1', 'secret:s2'],
    })
  )
  expect(recordSecretUsed).toHaveBeenCalledWith('s1')
  expect(recordSecretUsed).toHaveBeenCalledWith('s2')
})

it('20/분 초과 시 429, 감사·복호화 없음', async () => {
  count.mockResolvedValue(20)
  const res = await POST(req())
  expect(res.status).toBe(429)
  expect((await res.json()).message).toBe('잠시 후 다시 시도하세요')
  expect(count).toHaveBeenCalledWith({
    where: expect.objectContaining({ actorId: 'ag1', tool: { in: ['secret_env_issue'] } }),
  })
  expect(startToolAudit).not.toHaveBeenCalled()
  expect(load).not.toHaveBeenCalled()
})

it('모든 오류 응답에 Cache-Control: no-store', async () => {
  const cases: Array<[number, () => void, NextRequest?]> = [
    [401, () => verify.mockResolvedValueOnce(null)],
    [403, () => setting.mockResolvedValueOnce(null)],
    [400, () => undefined, req({ secrets: [] })],
    [429, () => count.mockResolvedValueOnce(20)],
    [503, () => (startToolAudit as jest.Mock).mockRejectedValueOnce(new Error('x'))],
    [500, () => verify.mockRejectedValueOnce(new Error('x'))],
    [403, () => load.mockRejectedValueOnce(new SecretUnavailableError('a-key'))],
  ]
  for (const [status, arrange, r] of cases) {
    arrange()
    const res = await POST(r ?? req())
    expect(res.status).toBe(status)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  }
})

it('응답 외 어디에도(console 포함) SK_TEST_0123456789abcdef 없음', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(console, m).mockImplementation(() => undefined)
  )
  try {
    await POST(req())
    load.mockRejectedValueOnce(new EnvNameConflictError('A_TOKEN'))
    await POST(req())
    load.mockImplementationOnce(async () => {
      throw new Error(`boom ${KEY}`)
    })
    await POST(req())
    const seen = JSON.stringify([
      ...spies.flatMap((s) => s.mock.calls),
      (startToolAudit as jest.Mock).mock.calls,
      (finishToolAudit as jest.Mock).mock.calls,
      (recordSecretUsed as jest.Mock).mock.calls,
    ])
    expect(seen).not.toContain(KEY)
  } finally {
    spies.forEach((s) => s.mockRestore())
  }
})
