/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { prisma } from '@/lib/prisma'
import { DELETE } from '../route'

jest.mock('@/lib/auth/mfa', () => ({ requireAal2: jest.fn() }))
jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  // 실제 역할 위계(OWNER > ADMIN > MEMBER)를 반영한 assertRole
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
  prisma: {
    salesContentChannel: { findFirst: jest.fn(), delete: jest.fn() },
    channelCredential: { count: jest.fn() },
  },
}))

const ctx = resolveDeckContext as jest.Mock
const mfa = requireAal2 as jest.Mock
const channel = prisma.salesContentChannel as unknown as { findFirst: jest.Mock; delete: jest.Mock }
const creds = prisma.channelCredential as unknown as { count: jest.Mock }

// 라우트 반환 타입에 undefined 가 섞여 있다(resolve* 의 error 타입) — 테스트에서는 응답이 반드시 있어야 한다.
const del = async () => {
  const res = await DELETE(new NextRequest('http://t/api/sc/channels/ch1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'ch1' }),
  })
  if (!res) throw new Error('응답이 없습니다')
  return res
}
const as = (role: string) => ctx.mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' }, role })

beforeEach(() => {
  jest.clearAllMocks()
  channel.findFirst.mockResolvedValue({ id: 'ch1' })
  mfa.mockResolvedValue(null)
})

describe('자격증명이 저장된 채널 삭제(자격증명이 cascade 로 함께 지워진다)', () => {
  beforeEach(() => creds.count.mockResolvedValue(1))

  test('MEMBER 는 403 권한 거부, MFA 검사·삭제 없음', async () => {
    as('MEMBER')
    const res = await del()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBeUndefined()
    expect(mfa).not.toHaveBeenCalled()
    expect(channel.delete).not.toHaveBeenCalled()
  })

  test('aal1 ADMIN 은 403 MFA_REQUIRED, 삭제 없음', async () => {
    as('ADMIN')
    mfa.mockResolvedValue(NextResponse.json({ code: 'MFA_REQUIRED' }, { status: 403 }))
    const res = await del()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('MFA_REQUIRED')
    expect(channel.delete).not.toHaveBeenCalled()
  })

  test('aal2 ADMIN 은 삭제된다', async () => {
    as('ADMIN')
    expect((await del()).status).toBe(200)
    expect(channel.delete).toHaveBeenCalledWith({ where: { id: 'ch1' } })
  })
})

test('자격증명이 없는 채널은 기존대로 MEMBER 도 MFA 없이 삭제할 수 있다', async () => {
  as('MEMBER')
  creds.count.mockResolvedValue(0)
  expect((await del()).status).toBe(200)
  expect(mfa).not.toHaveBeenCalled()
  expect(channel.delete).toHaveBeenCalled()
})
