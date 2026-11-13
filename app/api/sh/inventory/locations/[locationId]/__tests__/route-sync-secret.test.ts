/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PATCH } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 'sp' } })),
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

  it('비밀값 이름을 바꾸면 존재 확인 → 없으면 400', async () => {
    const res = await patch({ syncSecretName: 'other' })
    expect(res.status).toBe(400)
    expect(prisma.spaceSecret.findFirst).toHaveBeenCalled()
  })
})
