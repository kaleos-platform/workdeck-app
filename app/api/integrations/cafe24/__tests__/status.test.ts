/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { fakeDb } from '@/lib/cafe24/__tests__/fake-db'

jest.mock('@/lib/prisma', () => ({
  prisma: jest.requireActual('@/lib/cafe24/__tests__/fake-db').fakePrisma,
}))
jest.mock('@/lib/agent/identity/space-admin', () => ({ requireSpaceAdmin: jest.fn() }))

import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { GET } from '../status/route'

const SP = 'sp1'
const mockedAdmin = requireSpaceAdmin as jest.Mock
const get = (spaceId: string | null = SP) =>
  GET(new NextRequest(`https://app.test/x${spaceId ? `?spaceId=${spaceId}` : ''}`))

beforeEach(() => {
  fakeDb.reset()
  mockedAdmin.mockResolvedValue({ userId: 'u1', role: 'ADMIN' })
})

it('spaceId 없음 400, MEMBER 403', async () => {
  expect((await get(null)).status).toBe(400)
  mockedAdmin.mockResolvedValue({ error: NextResponse.json({}, { status: 403 }) })
  expect((await get()).status).toBe(403)
})

it('몰이 없으면 appConfigured false·빈 목록', async () => {
  expect(await (await get()).json()).toEqual({ appConfigured: false, limit: 5, malls: [] })
})

it('레거시+새 행을 mallId 오름차순으로 돌려주고 시크릿·clientId 는 싣지 않는다', async () => {
  fakeDb.seed(
    SP,
    { clientId: 'cid-SECRET-1', clientSecret: 'CSECRET-xyz', refreshToken: 'RT' },
    { mallId: 'legacy-shop', credVersion: 1, status: 'connected', connectedAt: 'T', scopes: ['a'] }
  )
  fakeDb.seed(
    SP,
    { clientId: 'cid-SECRET-1', clientSecret: 'CSECRET-xyz' },
    { mallId: 'aaa-shop', credVersion: 1, status: 'needs_auth' },
    'cafe24:aaa-shop'
  )
  fakeDb.rows[1].lastError = '오류'
  const text = JSON.stringify(await (await get()).json())
  const body = JSON.parse(text)
  expect(body.appConfigured).toBe(true)
  expect(body.malls).toEqual([
    { mallId: 'aaa-shop', status: 'needs_auth', connectedAt: null, scopes: [], error: '오류' },
    { mallId: 'legacy-shop', status: 'connected', connectedAt: 'T', scopes: ['a'], error: null },
  ])
  expect(text).not.toMatch(/SECRET|RT/)
})
