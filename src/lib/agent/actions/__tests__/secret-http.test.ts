/** @jest-environment node */
jest.mock('@/lib/agent/secrets/store')
jest.mock('@/lib/agent/secrets/http-client', () => ({
  ...jest.requireActual('@/lib/agent/secrets/http-client'),
  secretRequest: jest.fn(),
}))

import { secretRequest } from '@/lib/agent/secrets/http-client'
import * as store from '@/lib/agent/secrets/store'
import { ToolUserError } from '@/lib/agent/tools/errors'
import { maskParams } from '@/lib/agent/audit'
import { secretHttpActions } from '../secret-http'
import type { ActionExecContext } from '../types'

const KEY = 'SK_TEST_0123456789abcdef'
const def = secretHttpActions[0]
const ctx = (): ActionExecContext => ({
  spaceId: 'sp1',
  actor: { type: 'agent', id: 'ag1' },
  requesterUserId: null,
  workId: 'wk_t',
  decryptedCredentialIds: [],
})
const params = {
  secretId: 's1',
  secretName: 'my-api-key',
  target: 'my-api-key',
  url: 'https://api.example.com/orders',
  revision: 3,
  method: 'POST' as const,
  path: '/orders',
  body: { a: 1 },
}
const config = {
  baseUrl: 'https://api.example.com',
  auth: { in: 'header', name: 'X-Key', template: '{value}' },
  readOps: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(store.loadSecretForApproval as jest.Mock).mockResolvedValue({ id: 's1', value: KEY, config })
})

it('requiredRole은 OWNER다', () => {
  expect(def.requiredRole).toBe('OWNER')
  expect(def.actionType).toBe('secret.http.request')
})

it('revision이 다르면 실행을 거부하고 secretRequest를 부르지 않는다', async () => {
  ;(store.loadSecretForApproval as jest.Mock).mockRejectedValue(
    new ToolUserError('비밀값이 바뀌어 실행하지 않았습니다. 다시 제안하세요')
  )
  await expect(def.execute(ctx(), params)).rejects.toThrow('비밀값이 바뀌어 실행하지 않았습니다')
  expect(secretRequest).not.toHaveBeenCalled()
})

it('원 행위자(ctx.actor)로 재검증한다', async () => {
  ;(secretRequest as jest.Mock).mockResolvedValue({ status: 200, headers: {}, json: {} })
  const c = ctx()
  await def.execute(c, params)
  expect(store.loadSecretForApproval).toHaveBeenCalledWith(
    'sp1',
    's1',
    3,
    { type: 'agent', id: 'ag1' },
    c.decryptedCredentialIds
  )
})

it('실행 결과는 { status }만이다', async () => {
  ;(secretRequest as jest.Mock).mockResolvedValue({
    status: 201,
    headers: { 'set-cookie': 'a' },
    json: { leak: KEY },
  })
  await expect(def.execute(ctx(), params)).resolves.toEqual({ status: 201 })
  expect(store.recordSecretUsed).toHaveBeenCalledWith('s1')
})

it('validateCreate: path 우회 거부, revision 불일치 거부', async () => {
  ;(store.assertSecretUsable as jest.Mock).mockResolvedValue({
    id: 's1',
    revision: 4,
    baseUrl: 'https://api.example.com',
  })
  await expect(def.validateCreate!(ctx(), { ...params, path: '/a/../b' })).rejects.toThrow(
    '허용되지 않는 path입니다'
  )
  await expect(def.validateCreate!(ctx(), params)).rejects.toThrow('비밀값이 바뀌었습니다')
})

it('업스트림 4xx·5xx는 본문 없는 오류로 끝나 FAILED가 된다', async () => {
  ;(secretRequest as jest.Mock).mockResolvedValue({
    status: 502,
    headers: {},
    json: { error: `bad key ${KEY}` },
  })
  const err = (await def.execute(ctx(), params).catch((e) => e)) as Error
  expect(err).toBeInstanceOf(ToolUserError)
  expect(err.message).toBe('외부 API 오류: HTTP 502')
  expect(store.recordSecretError).toHaveBeenCalledWith('s1', 'HTTP 502')
  expect(store.recordSecretUsed).not.toHaveBeenCalled()
})

it('validateCreate: 표시 url·target이 실제 요청과 다르면 거부', async () => {
  ;(store.assertSecretUsable as jest.Mock).mockResolvedValue({
    id: 's1',
    revision: 3,
    baseUrl: 'https://api.example.com/',
  })
  await expect(def.validateCreate!(ctx(), params)).resolves.toBeUndefined()
  await expect(
    def.validateCreate!(ctx(), { ...params, url: 'https://evil.example.com/orders' })
  ).rejects.toThrow('표시 정보가 요청과 다릅니다')
  await expect(def.validateCreate!(ctx(), { ...params, target: 'other' })).rejects.toThrow(
    '표시 정보가 요청과 다릅니다'
  )
})

it('승인 화면: maskParams를 거쳐도 snapshot·payload에 이름·method·URL이 보인다(spec §3.5)', async () => {
  const snap = await def.snapshot!(ctx(), params)
  expect(maskParams(snap)).toEqual({
    target: 'my-api-key',
    method: 'POST',
    url: 'https://api.example.com/orders',
    revision: 3,
  })
  expect(maskParams(params)).toMatchObject({
    target: 'my-api-key',
    url: 'https://api.example.com/orders',
    method: 'POST',
    // 실행 결속 키는 그대로 payload에 있다(표시만 가려짐)
    secretId: '[redacted]',
  })
  expect(params).toMatchObject({ secretId: 's1', revision: 3 })
})

describe('validateCreate: 승인 화면에서 가려지는 query·body는 제안할 수 없다', () => {
  const HIDDEN = '승인 화면에서 가려지는 키·값은 제안할 수 없습니다'
  beforeEach(() => {
    ;(store.assertSecretUsable as jest.Mock).mockResolvedValue({
      id: 's1',
      revision: 3,
      baseUrl: 'https://api.example.com',
    })
  })
  it.each([
    ['body 키가 비밀 키 패턴', { body: { api_key: 'x' } }],
    ['중첩 body 키', { body: { a: { password: 'x' } } }],
    ['body 값이 마스킹 패턴', { body: { note: 'token=abc' } }],
    ['query 키가 비밀 키 패턴', { query: { access_token: 'x' } }],
    ['query 값이 Bearer', { query: { q: 'Bearer abc' } }],
  ])('%s → 거부', async (_n, extra) => {
    await expect(def.validateCreate!(ctx(), { ...params, ...extra })).rejects.toThrow(HIDDEN)
  })
  it('가려지지 않는 query·body는 통과', async () => {
    await expect(
      def.validateCreate!(ctx(), { ...params, query: { page: '1' }, body: { a: 1, b: [true] } })
    ).resolves.toBeUndefined()
  })
})
