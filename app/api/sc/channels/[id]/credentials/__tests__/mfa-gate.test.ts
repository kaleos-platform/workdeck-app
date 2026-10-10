/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { deleteChannelCredential, upsertChannelCredential } from '@/lib/sc/credentials'
import { DELETE, POST } from '../route'

jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  const rank = { OWNER: 3, ADMIN: 2, MEMBER: 1 } as const
  return {
    resolveDeckContext: jest.fn(),
    errorResponse: (message: string, status: number) => NextResponse.json({ message }, { status }),
    assertRole: (r: keyof typeof rank, req: keyof typeof rank) =>
      rank[r] < rank[req]
        ? NextResponse.json({ message: '권한이 없습니다' }, { status: 403 })
        : null,
  }
})
jest.mock('@/lib/prisma', () => ({
  prisma: { salesContentChannel: { findFirst: jest.fn().mockResolvedValue({ id: 'ch1' }) } },
}))
jest.mock('@/lib/sc/credentials', () => ({
  upsertChannelCredential: jest.fn(),
  deleteChannelCredential: jest.fn(),
}))

const ctx = resolveDeckContext as jest.Mock
const mfa = requireAal2 as jest.Mock
// 라우트 반환 타입에 undefined 가 섞여 있다(resolve* 의 error 타입) — 테스트에서는 응답이 반드시 있어야 한다.
const must = <T>(res: T | undefined): T => {
  if (!res) throw new Error('응답이 없습니다')
  return res
}
const params = { params: Promise.resolve({ id: 'ch1' }) }
const post = async () =>
  must(
    await POST(
      new NextRequest('http://t/api/sc/channels/ch1/credentials', {
        method: 'POST',
        body: JSON.stringify({ kind: 'COOKIE', payload: {} }),
      }),
      params
    )
  )
const del = async () =>
  must(
    await DELETE(
      new NextRequest('http://t/api/sc/channels/ch1/credentials?kind=COOKIE', { method: 'DELETE' }),
      params
    )
  )

beforeEach(() => {
  jest.clearAllMocks()
  ctx.mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' }, role: 'ADMIN' })
  mfa.mockResolvedValue(null)
})

test('aal2 미충족이면 저장·삭제하지 않고 403 MFA_REQUIRED', async () => {
  mfa.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
  expect((await post()).status).toBe(403)
  expect((await del()).status).toBe(403)
  expect(upsertChannelCredential).not.toHaveBeenCalled()
  expect(deleteChannelCredential).not.toHaveBeenCalled()
})

test('MEMBER 는 aal2 여도 저장·삭제할 수 없다(역할 검사가 MFA 보다 먼저)', async () => {
  ctx.mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' }, role: 'MEMBER' })
  const res = await post()
  expect(res.status).toBe(403)
  expect((await res.json()).code).toBeUndefined() // MFA 안내가 아니라 권한 거부
  expect((await del()).status).toBe(403)
  expect(mfa).not.toHaveBeenCalled()
  expect(upsertChannelCredential).not.toHaveBeenCalled()
  expect(deleteChannelCredential).not.toHaveBeenCalled()
})

test('ADMIN + aal2 → 저장된다', async () => {
  ;(upsertChannelCredential as jest.Mock).mockResolvedValue({
    id: 'c1',
    kind: 'COOKIE',
    expiresAt: null,
    updatedAt: new Date(),
  })
  expect((await post()).status).toBe(201)
})
