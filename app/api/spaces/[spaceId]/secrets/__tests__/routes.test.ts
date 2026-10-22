/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/lib/prisma', () => ({ prisma: { spaceAgent: { count: jest.fn() } } }))
jest.mock('@/lib/agent/identity/space-admin', () => ({
  requireSpaceAdmin: jest.fn(async () => ({ userId: 'u1' })),
}))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn(), requireFreshAal2: jest.fn() }))
jest.mock('@/lib/agent/audit', () => ({
  AUDIT_UNAVAILABLE: '감사 기록을 남길 수 없어 실행하지 않았습니다',
  startToolAudit: jest.fn(async () => 'audit1'),
  finishToolAudit: jest.fn(async () => undefined),
}))
jest.mock('@/lib/agent/secrets/store', () => ({
  SECRET_NAME_RE: /^[a-z0-9][a-z0-9-]{1,62}$/,
  listSecretMeta: jest.fn(),
  findSecretForUpdate: jest.fn(),
  saveApiKeySecret: jest.fn(async () => ({ id: 's1', revision: 1 })),
  deleteSecret: jest.fn(async () => true),
  revealSecretValue: jest.fn(async () => ({ id: 's1', value: 'SK_TEST_0123456789abcdef' })),
}))

import { prisma } from '@/lib/prisma'
import { requireAal2, requireFreshAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { startToolAudit, finishToolAudit } from '@/lib/agent/audit'
import * as store from '@/lib/agent/secrets/store'
import { GET } from '../route'
import { PUT, DELETE } from '../[name]/route'
import { POST as REVEAL } from '../[name]/reveal/route'

const BODY = {
  kind: 'API_KEY',
  value: 'SK_TEST_0123456789abcdef',
  config: {
    baseUrl: 'https://api.example.com',
    auth: { in: 'header', name: 'Authorization', template: 'Bearer {value}' },
    readOps: [],
  },
  allowedAgentIds: ['a1'],
}
const ctx = { params: Promise.resolve({ spaceId: 'sp1', name: 'cafe24-admin' }) }
const put = (body: unknown = BODY) =>
  PUT(new NextRequest('http://t/x', { method: 'PUT', body: JSON.stringify(body) }), ctx)
const mfaFail = () => NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(null)
  ;(prisma.spaceAgent.count as jest.Mock).mockResolvedValue(1)
  ;(store.findSecretForUpdate as jest.Mock).mockResolvedValue(null)
})

it('aal2가 없으면 PUT·DELETE·reveal 모두 403이고 본문을 읽지 않는다', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(mfaFail())
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(mfaFail())
  const req = new NextRequest('http://t/x', { method: 'PUT', body: JSON.stringify(BODY) })
  const json = jest.spyOn(req, 'json')
  expect((await PUT(req, ctx)).status).toBe(403)
  expect(json).not.toHaveBeenCalled()
  expect((await DELETE(new NextRequest('http://t/x', { method: 'DELETE' }), ctx)).status).toBe(403)
  expect((await REVEAL(new NextRequest('http://t/x', { method: 'POST' }), ctx)).status).toBe(403)
  expect(store.saveApiKeySecret).not.toHaveBeenCalled()
  expect(store.deleteSecret).not.toHaveBeenCalled()
  expect(startToolAudit).not.toHaveBeenCalled()
})

it('MEMBER의 GET은 403', async () => {
  ;(requireSpaceAdmin as jest.Mock).mockResolvedValueOnce({
    error: NextResponse.json({}, { status: 403 }),
  })
  expect(
    (await GET(new Request('http://t/x'), { params: Promise.resolve({ spaceId: 'sp1' }) })).status
  ).toBe(403)
  expect(store.listSecretMeta).not.toHaveBeenCalled()
})

it('GET 응답에 값·암호문·IV가 없다', async () => {
  ;(store.listSecretMeta as jest.Mock).mockResolvedValue([
    {
      name: 'cafe24-admin',
      kind: 'API_KEY',
      baseUrl: 'https://api.example.com',
      readOpIds: [],
      allowedAgentIds: ['a1'],
      revision: 1,
      lastUsedAt: null,
      lastError: null,
      updatedAt: new Date(),
    },
  ])
  const res = await GET(new Request('http://t/x'), { params: Promise.resolve({ spaceId: 'sp1' }) })
  const text = await res.text()
  expect(res.status).toBe(200)
  expect(text).not.toMatch(/SK_TEST|encryptedPayload|"iv"/)
})

it('PUT 성공: 응답에 값이 없고 no-store', async () => {
  const res = await put()
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('no-store')
  const text = await res.text()
  expect(JSON.parse(text)).toEqual({ name: 'cafe24-admin', revision: 1 })
  expect(text).not.toContain('SK_TEST')
})

it('다른 Space의 agent id는 400', async () => {
  ;(prisma.spaceAgent.count as jest.Mock).mockResolvedValue(0)
  expect((await put()).status).toBe(400)
  expect(store.saveApiKeySecret).not.toHaveBeenCalled()
})

it('kind가 API_KEY가 아니면 400, 기존 행 kind가 다르면 409', async () => {
  expect((await put({ ...BODY, kind: 'LOGIN' })).status).toBe(400)
  ;(store.findSecretForUpdate as jest.Mock).mockResolvedValue({
    kind: 'LOGIN',
    config: {},
    allowedAgentIds: [],
  })
  const res = await put()
  expect(res.status).toBe(409)
  expect(store.saveApiKeySecret).not.toHaveBeenCalled()
})

it('DELETE는 204', async () => {
  expect((await DELETE(new NextRequest('http://t/x', { method: 'DELETE' }), ctx)).status).toBe(204)
})

it('reveal: no-store 응답, 감사 시작·종료(secret:id)', async () => {
  const res = await REVEAL(new NextRequest('http://t/x', { method: 'POST' }), ctx)
  expect(res.status).toBe(200)
  expect(res.headers.get('cache-control')).toBe('no-store')
  await expect(res.json()).resolves.toEqual({ value: 'SK_TEST_0123456789abcdef' })
  expect(startToolAudit).toHaveBeenCalledWith(
    expect.objectContaining({
      tool: 'secret.reveal',
      args: { name: 'cafe24-admin' },
      requesterUserId: null,
    })
  )
  expect(finishToolAudit).toHaveBeenCalledWith(
    'audit1',
    expect.objectContaining({ outcome: 'ok', decryptedCredentialIds: ['secret:s1'] })
  )
})

it('reveal: 감사 시작 실패면 503이고 값을 읽지도 내보내지도 않는다', async () => {
  ;(startToolAudit as jest.Mock).mockRejectedValueOnce(new Error('db down'))
  const res = await REVEAL(new NextRequest('http://t/x', { method: 'POST' }), ctx)
  expect(res.status).toBe(503)
  expect(await res.text()).not.toContain('SK_TEST')
  expect(store.revealSecretValue).not.toHaveBeenCalled()
})

it('kind가 LOGIN이고 config가 {}여도 API_KEY 안내 메시지로 400', async () => {
  const res = await put({ kind: 'LOGIN', value: 'x', config: {}, allowedAgentIds: [] })
  expect(res.status).toBe(400)
  expect(await res.text()).toContain('이 단계에서는 API_KEY만 등록할 수 있습니다')
})

it('allowedAgentIds는 ACTIVE 에이전트만 센다', async () => {
  await put()
  expect(prisma.spaceAgent.count).toHaveBeenCalledWith({
    where: expect.objectContaining({ spaceId: 'sp1', status: 'ACTIVE' }),
  })
})

it('MFA 비상 해제(requireAal2 통과)여도 실제 aal2가 없으면 reveal은 403이고 값·감사 없음', async () => {
  ;(requireFreshAal2 as jest.Mock).mockResolvedValue(mfaFail())
  const res = await REVEAL(new NextRequest('http://t/x', { method: 'POST' }), ctx)
  expect(res.status).toBe(403)
  expect(await res.text()).not.toContain('SK_TEST')
  expect(store.revealSecretValue).not.toHaveBeenCalled()
  expect(startToolAudit).not.toHaveBeenCalled()
})

it.each([
  ['줄바꿈', 'SK_TEST_0123\r\nX-Evil: 1'],
  ['공백', 'SK_TEST 0123456789'],
  ['비ASCII', 'SK_TEST_키값0123456789'],
  ['NUL', 'SK_TEST_\u00000123456789'],
])('값에 %s이 있으면 400이고 저장하지 않으며 응답에 값이 없다', async (_l, value) => {
  const res = await put({ ...BODY, value })
  expect(res.status).toBe(400)
  expect(await res.text()).not.toContain('SK_TEST')
  expect(store.saveApiKeySecret).not.toHaveBeenCalled()
})

describe('PUT·DELETE 감사(fail-closed)', () => {
  const del = () => DELETE(new NextRequest('http://t/x', { method: 'DELETE' }), ctx)

  it('신규 등록: secret.put 감사 시작·종료, args에 값 없음', async () => {
    expect((await put()).status).toBe(200)
    expect(startToolAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'secret.put',
        actor: { type: 'user', id: 'u1' },
        args: {
          name: 'cafe24-admin',
          created: true,
          changed: ['value', 'config', 'allowedAgentIds'],
        },
      })
    )
    expect(JSON.stringify((startToolAudit as jest.Mock).mock.calls)).not.toContain('SK_TEST')
    expect(finishToolAudit).toHaveBeenCalledWith(
      'audit1',
      expect.objectContaining({ outcome: 'ok' })
    )
  })

  it('교체: 바뀐 필드만 changed에 남는다(키 순서·허용 목록 순서 무관)', async () => {
    ;(store.findSecretForUpdate as jest.Mock).mockResolvedValue({
      kind: 'API_KEY',
      // jsonb는 키 순서를 바꿔 돌려준다
      config: {
        readOps: [],
        auth: { template: 'Bearer {value}', name: 'Authorization', in: 'header' },
        baseUrl: 'https://api.example.com',
      },
      allowedAgentIds: ['a1'],
    })
    await put()
    expect((startToolAudit as jest.Mock).mock.calls[0][0].args).toEqual({
      name: 'cafe24-admin',
      created: false,
      changed: ['value'],
    })
    ;(startToolAudit as jest.Mock).mockClear()
    ;(store.findSecretForUpdate as jest.Mock).mockResolvedValue({
      kind: 'API_KEY',
      config: { ...BODY.config, baseUrl: 'https://old.example.com' },
      allowedAgentIds: [],
    })
    await put()
    expect((startToolAudit as jest.Mock).mock.calls[0][0].args.changed).toEqual([
      'value',
      'config',
      'allowedAgentIds',
    ])
  })

  it('감사 시작 실패면 PUT·DELETE 모두 503이고 쓰지 않는다', async () => {
    ;(startToolAudit as jest.Mock).mockRejectedValue(new Error('db down'))
    expect((await put()).status).toBe(503)
    expect((await del()).status).toBe(503)
    expect(store.saveApiKeySecret).not.toHaveBeenCalled()
    expect(store.deleteSecret).not.toHaveBeenCalled()
    ;(startToolAudit as jest.Mock).mockResolvedValue('audit1')
  })

  it('DELETE: secret.delete 감사, 없으면 404와 error=not_found', async () => {
    expect((await del()).status).toBe(204)
    expect(startToolAudit).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'secret.delete', args: { name: 'cafe24-admin' } })
    )
    expect(finishToolAudit).toHaveBeenCalledWith(
      'audit1',
      expect.objectContaining({ outcome: 'ok' })
    )
    ;(store.deleteSecret as jest.Mock).mockResolvedValueOnce(false)
    expect((await del()).status).toBe(404)
    expect(finishToolAudit).toHaveBeenLastCalledWith(
      'audit1',
      expect.objectContaining({ outcome: 'error', error: 'not_found' })
    )
  })

  it('저장이 throw하면 500이고 감사는 error로 끝난다', async () => {
    ;(store.saveApiKeySecret as jest.Mock).mockRejectedValueOnce(new Error('db'))
    expect((await put()).status).toBe(500)
    expect(finishToolAudit).toHaveBeenCalledWith(
      'audit1',
      expect.objectContaining({ outcome: 'error', error: 'write_failed' })
    )
  })
})

it('config 오류는 경로·메시지를 400 본문에 싣는다', async () => {
  const res = await put({ ...BODY, config: { ...BODY.config, baseUrl: 'http://api.example.com' } })
  expect(res.status).toBe(400)
  const { message } = await res.json()
  expect(message).toContain('config.baseUrl')
  expect(message).toContain('baseUrl은 https 도메인만 허용합니다')
  expect(message).not.toContain('SK_TEST')
})

it('value 오류는 고정 안내만 싣고 값을 되돌리지 않는다', async () => {
  const res = await put({ ...BODY, value: 'SK_TEST_\n0123456789' })
  const { message } = await res.json()
  expect(message).toContain('값은 공백 없는 영문·숫자·기호(ASCII) 8~4096자여야 합니다')
  expect(message).not.toContain('SK_TEST')
})
