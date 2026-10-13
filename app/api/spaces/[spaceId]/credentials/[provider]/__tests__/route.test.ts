/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'

jest.mock('@/lib/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/agent/identity/space-admin', () => ({
  requireSpaceAdmin: jest.fn(async () => ({ userId: 'u1' })),
}))
jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/agent/integrations/space-credential', () => ({
  saveSpaceCredential: jest.fn(async () => ({ id: 'cred1' })),
  loadSpaceCredential: jest.fn(),
  recordCredentialError: jest.fn(),
}))

import { requireAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { saveSpaceCredential } from '@/lib/agent/integrations/space-credential'
import { PUT } from '../route'

const META_BODY = {
  secret: { accessToken: 'EAAB-test-token', appSecret: 'app-secret-test' },
  // 클라이언트가 보낸 통화는 무시
  config: {
    defaultBrand: 'brand-a',
    adAccounts: { 'brand-a': '111' },
    accountCurrencies: { act_111: 'KRW' },
  },
}
const call = (provider: string, body: unknown) =>
  PUT(
    new NextRequest(`http://t/api/spaces/sp1/credentials/${provider}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ spaceId: 'sp1', provider }) }
  )
let fetchMock: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAal2 as jest.Mock).mockResolvedValue(null)
  fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({ id: 'act_111', currency: 'USD' }),
  }))
  global.fetch = fetchMock as unknown as typeof fetch
})

it('ADMIN 미만 → 그대로 거부, MFA·저장 검사 전', async () => {
  ;(requireSpaceAdmin as jest.Mock).mockResolvedValueOnce({
    error: NextResponse.json({}, { status: 403 }),
  })
  expect((await call('meta-ads', META_BODY)).status).toBe(403)
  expect(requireAal2).not.toHaveBeenCalled()
  expect(saveSpaceCredential).not.toHaveBeenCalled()
})

it('MFA 미충족 → 403 MFA_REQUIRED, 저장·Graph 호출 없음', async () => {
  ;(requireAal2 as jest.Mock).mockResolvedValue(
    NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 })
  )
  const res = await call('meta-ads', META_BODY)
  expect(res.status).toBe(403)
  await expect(res.json()).resolves.toMatchObject({ code: 'MFA_REQUIRED' })
  expect(saveSpaceCredential).not.toHaveBeenCalled()
  expect(fetchMock).not.toHaveBeenCalled()
})

it('모르는 provider → 404', async () => {
  expect((await call('constructor', META_BODY)).status).toBe(404)
  expect(saveSpaceCredential).not.toHaveBeenCalled()
})

it('메타: Graph가 확인한 통화를 저장한다(클라이언트 값 무시), 응답에 비밀값 없음', async () => {
  const res = await call('meta-ads', META_BODY)
  expect(res.status).toBe(200)
  const json = await res.json()
  expect(json).toMatchObject({ accountCurrencies: { act_111: 'USD' } })
  expect(JSON.stringify(json)).not.toMatch(/EAAB|app-secret/)
  const savedConfig = (saveSpaceCredential as jest.Mock).mock.calls[0][3]
  expect(savedConfig.accountCurrencies).toEqual({ act_111: 'USD' })
})

it('메타: 계정 확인 실패 → 400, 저장하지 않는다', async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: { message: 'Invalid OAuth access token' } }),
  })
  const res = await call('meta-ads', META_BODY)
  expect(res.status).toBe(400)
  expect(saveSpaceCredential).not.toHaveBeenCalled()
})
