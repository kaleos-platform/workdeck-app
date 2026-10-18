/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PUT } from '../route'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(async () => ({ space: { id: 's1' }, user: { id: 'u' } })),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { brand: { findFirst: jest.fn() }, brandProfile: { findFirst: jest.fn() } },
}))
jest.mock('@/lib/sc/brand-profile', () => ({
  ...jest.requireActual('@/lib/sc/brand-profile'),
  saveBrandProfileNow: jest.fn(async () => ({ id: 'bp' })),
}))
import { prisma } from '@/lib/prisma'
import { saveBrandProfileNow } from '@/lib/sc/brand-profile'

async function put(body: unknown) {
  const res = await PUT(
    new NextRequest('http://localhost/api/sc/brand-profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  )
  if (!res) throw new Error('응답 없음')
  return res
}

beforeEach(() => jest.clearAllMocks())

it('다른 Space 의 브랜드로는 저장하지 않는다', async () => {
  ;(prisma.brand.findFirst as jest.Mock).mockResolvedValue(null)
  const res = await put({ companyName: 'A', brandId: 'other-space-brand' })
  expect(res.status).toBe(404)
  expect(prisma.brand.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'other-space-brand', spaceId: 's1' } })
  )
  expect(saveBrandProfileNow).not.toHaveBeenCalled()
})

it('brandId 가 없거나 빈 값이면 공통 프로필로 저장한다', async () => {
  const res = await put({ companyName: 'A', brandId: '' })
  expect(res.status).toBe(200)
  expect(saveBrandProfileNow).toHaveBeenCalledWith('s1', null, expect.anything())
})
