/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveSpaceContext } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { DELETE, PUT } from '../route'

jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn().mockResolvedValue({ id: 'u' }) }))
jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  // 실제 역할 위계(OWNER > ADMIN > MEMBER)를 반영한 assertRole
  const rank = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const
  return {
    resolveSpaceContext: jest.fn(),
    errorResponse: (message: string, status: number) => NextResponse.json({ message }, { status }),
    assertRole: (r: keyof typeof rank, req: keyof typeof rank) =>
      rank[r] < rank[req]
        ? NextResponse.json({ message: '권한이 없습니다' }, { status: 403 })
        : null,
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
  ;(resolveSpaceContext as jest.Mock).mockResolvedValue({
    user: { id: 'u' },
    space: { id: 's1' },
    role: 'ADMIN',
  })
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

const putReq = async (body: unknown) =>
  must(
    await PUT(
      new NextRequest('http://t/api/settings/ai', { method: 'PUT', body: JSON.stringify(body) })
    )
  )

test('키 없이 provider 를 바꾸면 aal2 가 필요하다(저장된 키를 다른 공급자로 재사용)', async () => {
  ai.findUnique.mockResolvedValue({ mode: 'BYOK', provider: 'OPENAI', encryptedApiKey: 'enc' })
  expect((await putReq({ mode: 'BYOK', provider: 'ANTHROPIC' })).status).toBe(403)
  expect(ai.upsert).not.toHaveBeenCalled()
})

test('키 없이 저장된 키로 BYOK 전환하면 aal2 가 필요하다', async () => {
  ai.findUnique.mockResolvedValue({ mode: 'WORKDECK', provider: null, encryptedApiKey: 'enc' })
  expect((await putReq({ mode: 'BYOK', provider: 'OPENAI' })).status).toBe(403)
  expect(ai.upsert).not.toHaveBeenCalled()
})

test('같은 공급자 BYOK 에서 모델만 바꾸면 MFA 없이 통과', async () => {
  ai.findUnique.mockResolvedValue({ mode: 'BYOK', provider: 'OPENAI', encryptedApiKey: 'enc' })
  ai.upsert.mockResolvedValue({
    mode: 'BYOK',
    provider: 'OPENAI',
    model: 'm',
    encryptedApiKey: 'enc',
  })
  expect((await putReq({ mode: 'BYOK', provider: 'OPENAI', model: 'm' })).status).toBe(200)
  expect(mfa).not.toHaveBeenCalled()
})

test('MEMBER 의 PUT·DELETE 는 403 권한 거부, MFA 검사·DB 쓰기 없음', async () => {
  ;(resolveSpaceContext as jest.Mock).mockResolvedValue({
    user: { id: 'u' },
    space: { id: 's1' },
    role: 'MEMBER',
  })
  const res = await putReq({ mode: 'BYOK', provider: 'OPENAI', apiKey: 'sk-12345678' })
  expect(res.status).toBe(403)
  expect((await res.json()).code).toBeUndefined()
  expect(must(await DELETE()).status).toBe(403)
  expect(mfa).not.toHaveBeenCalled()
  expect(ai.findUnique).not.toHaveBeenCalled()
  expect(ai.upsert).not.toHaveBeenCalled()
  expect(ai.update).not.toHaveBeenCalled()
})
