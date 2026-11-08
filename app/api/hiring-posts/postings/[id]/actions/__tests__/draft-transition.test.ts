/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findFirst: jest.fn(), updateManyAndReturn: jest.fn() } },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 'space' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/hiring/postings', () => ({ checkPublishable: jest.fn() }))

const params = { params: Promise.resolve({ id: 'posting' }) }
const request = (action: string) =>
  new NextRequest('http://localhost/actions', {
    method: 'POST',
    body: JSON.stringify({ action }),
  })

beforeEach(() => jest.clearAllMocks())

it.each(['close', 'archive'])('発行前の超案で %s を拒否する', async (action) => {
  jest
    .mocked(prisma.hiringPosting.findFirst)
    .mockResolvedValue({ id: 'posting', status: 'DRAFT', publishedAt: null } as never)
  jest.mocked(prisma.hiringPosting.updateManyAndReturn).mockResolvedValue([])
  expect((await POST(request(action), params))?.status).toBe(409)
  expect(prisma.hiringPosting.updateManyAndReturn).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: 'posting',
        spaceId: 'space',
        OR: [{ status: { not: 'DRAFT' } }, { publishedAt: { not: null } }],
      },
    })
  )
})

it.each(['close', 'archive'])('発行履歴のある以前の超案の %s を許可する', async (action) => {
  const status = action === 'close' ? 'CLOSED' : 'ARCHIVED'
  jest
    .mocked(prisma.hiringPosting.findFirst)
    .mockResolvedValue({
      id: 'posting',
      status: 'DRAFT',
      publishedAt: new Date('2023-01-01'),
    } as never)
  jest
    .mocked(prisma.hiringPosting.updateManyAndReturn)
    .mockResolvedValue([{ id: 'posting', status }] as never)
  const response = await POST(request(action), params)
  expect(response?.status).toBe(200)
  expect(await response?.json()).toEqual({ posting: { id: 'posting', status } })
})

it.each(['close', 'archive'])(
  '読み取り後に超案となった %s の条件付き更新失敗を拒否する',
  async (action) => {
    jest
      .mocked(prisma.hiringPosting.findFirst)
      .mockResolvedValue({ id: 'posting', status: 'ACTIVE', publishedAt: new Date() } as never)
    jest.mocked(prisma.hiringPosting.updateManyAndReturn).mockResolvedValue([])
    expect((await POST(request(action), params))?.status).toBe(409)
    expect(prisma.hiringPosting.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'posting',
          spaceId: 'space',
          OR: [{ status: { not: 'DRAFT' } }, { publishedAt: { not: null } }],
        },
      })
    )
  }
)
