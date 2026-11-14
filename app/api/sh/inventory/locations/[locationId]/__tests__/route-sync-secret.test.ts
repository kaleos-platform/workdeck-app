/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PATCH } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  assertRole: (role: string) =>
    role === 'MEMBER' ? Response.json({ message: '권한이 없습니다' }, { status: 403 }) : null,
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    invStorageLocation: { findFirst: jest.fn(), update: jest.fn(async () => ({})) },
    spaceSecret: { findFirst: jest.fn() },
  },
}))

const loc = {
  id: 'l',
  name: 'A',
  type: 'THIRD_PARTY',
  isActive: true,
  syncProvider: 'wekeep',
  syncSecretName: 'wk',
  autoReconcileWeekly: false,
}
const patch = async (body: object) =>
  (await PATCH(new NextRequest('http://x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ locationId: 'l' }),
  })) as Response

describe('PATCH location — 비밀값 존재 확인', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'sp' }, role: 'ADMIN' })
    ;(prisma.invStorageLocation.findFirst as jest.Mock).mockImplementation(
      async (a: { where: { id?: string } }) => (a.where.id === 'l' ? loc : null)
    )
    ;(prisma.spaceSecret.findFirst as jest.Mock).mockResolvedValue(null)
  })

  it('같은 비밀값 이름 유지 + 위치명 변경은 비밀값이 삭제됐어도 통과', async () => {
    const res = await patch({ name: 'B', syncSecretName: 'wk' })
    expect(res.status).toBe(200)
    expect(prisma.spaceSecret.findFirst).not.toHaveBeenCalled()
  })

  it('MEMBER 가 비밀값을 바꾸면 403', async () => {
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'sp' }, role: 'MEMBER' })
    const res = await patch({ syncSecretName: 'other' })
    expect(res.status).toBe(403)
    expect(prisma.invStorageLocation.update).not.toHaveBeenCalled()
  })

  it('MEMBER 가 연동 필드 변경 없이 이름만 바꾸면 200', async () => {
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 'sp' }, role: 'MEMBER' })
    expect((await patch({ name: 'B', syncSecretName: 'wk' })).status).toBe(200)
  })

  it('ADMIN 이 위킵 도메인이 아닌 비밀값을 연결하면 400', async () => {
    ;(prisma.spaceSecret.findFirst as jest.Mock).mockResolvedValue({
      id: 'x',
      config: { loginUrl: 'https://evil.com/login' },
    })
    expect((await patch({ syncSecretName: 'other' })).status).toBe(400)
  })

  it('ADMIN 이 위킵 비밀값을 연결하면 200', async () => {
    ;(prisma.spaceSecret.findFirst as jest.Mock).mockResolvedValue({
      id: 'x',
      config: { loginUrl: 'https://www.wekeep.co.kr/login' },
    })
    expect((await patch({ syncSecretName: 'other' })).status).toBe(200)
  })

  it('비밀값 이름을 바꾸면 존재 확인 → 없으면 400', async () => {
    const res = await patch({ syncSecretName: 'other' })
    expect(res.status).toBe(400)
    expect(prisma.spaceSecret.findFirst).toHaveBeenCalled()
  })
})
