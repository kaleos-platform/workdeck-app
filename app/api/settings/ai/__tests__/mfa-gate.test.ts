/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAal2 } from '@/lib/auth/mfa'
import { DELETE, PUT } from '../route'

jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn().mockResolvedValue({ id: 'u' }) }))
jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  return {
    resolveSpaceContext: jest
      .fn()
      .mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' }, role: 'ADMIN' }),
    errorResponse: (message: string, status: number) => NextResponse.json({ message }, { status }),
    assertRole: () => null,
  }
})
jest.mock('@/lib/ai/credit', () => ({ getMonthUsage: jest.fn() }))
jest.mock('@/lib/ai/resolve', () => ({ workdeckProvider: () => null }))
jest.mock('@/lib/prisma', () => ({
  prisma: { spaceAiSetting: { findUnique: jest.fn(), update: jest.fn(), upsert: jest.fn() } },
}))

const ai = prisma.spaceAiSetting as unknown as {
  findUnique: jest.Mock
  update: jest.Mock
  upsert: jest.Mock
}
const mfa = requireAal2 as jest.Mock

// 라우트 반환 타입에 undefined 가 섞여 있다(resolve* 의 error 타입) — 테스트에서는 응답이 반드시 있어야 한다.
const must = <T>(res: T | undefined): T => {
  if (!res) throw new Error('응답이 없습니다')
  return res
}

beforeEach(() => {
  jest.clearAllMocks()
  mfa.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
  ai.findUnique.mockResolvedValue({ id: 'a1', encryptedApiKey: 'enc' })
})

test('aal2 미충족이면 AI 키 삭제(DELETE)를 하지 않는다', async () => {
  expect(must(await DELETE()).status).toBe(403)
  expect(ai.update).not.toHaveBeenCalled()
})

test('aal2 미충족이면 키 저장(PUT apiKey)을 하지 않는다. 키 없는 모드 전환은 통과', async () => {
  const put = async (body: unknown) =>
    must(
      await PUT(
        new NextRequest('http://t/api/settings/ai', { method: 'PUT', body: JSON.stringify(body) })
      )
    )
  expect(
    (await put({ mode: 'BYOK', provider: 'ANTHROPIC', apiKey: 'sk-ant-12345678' })).status
  ).toBe(403)
  expect(ai.upsert).not.toHaveBeenCalled()
  ai.upsert.mockResolvedValue({
    mode: 'WORKDECK',
    provider: null,
    model: null,
    encryptedApiKey: 'enc',
  })
  expect((await put({ mode: 'WORKDECK' })).status).toBe(200)
})
