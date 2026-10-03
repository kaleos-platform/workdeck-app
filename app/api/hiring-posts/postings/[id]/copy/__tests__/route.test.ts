/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn(),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findFirst: jest.fn() }, $transaction: jest.fn() },
}))
const tx = {
  hiringPosting: { create: jest.fn() },
  hiringPostingPosition: { createMany: jest.fn() },
  hiringPostingStore: { createMany: jest.fn() },
  hiringContent: { createMany: jest.fn() },
}
const source = {
  id: 'source',
  spaceId: 'space-qa',
  title: '원본',
  status: 'ACTIVE',
  uuid: 'old-public',
  applicationEntries: [{ key: 'name', label: '이름' }],
  detail: { test: true },
  notificationEnabled: false,
  closingDate: new Date(),
  publishedAt: new Date(),
  authorUserId: 'old-user',
  managerNameEnc: 'private',
  positions: [
    {
      spaceId: 'space-qa',
      positionId: 'position',
      name: '직무',
      payAmount: 12000,
      workDays: [1, 2],
    },
  ],
  stores: [{ storeId: 'store' }],
  contents: [
    {
      spaceId: 'space-qa',
      sourceType: 'POSTING_DETAIL',
      contentType: 'design',
      title: '복원할 카드 제목',
      data: { scene: 'qa' },
      imagePath: 'qa/image.png',
      sortOrder: 3,
    },
  ],
}
const request = async () => {
  const response = await POST(
    new NextRequest('http://localhost/api/hiring-posts/postings/source/copy', { method: 'POST' }),
    { params: Promise.resolve({ id: 'source' }) }
  )
  if (!response) throw new Error('응답이 없습니다')
  return response
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({
    user: { id: 'current-user' },
    space: { id: 'space-qa' },
  })
  ;(prisma.hiringPosting.findFirst as jest.Mock).mockResolvedValue(source)
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(tx))
  tx.hiringPosting.create.mockResolvedValue({ id: 'copy' })
})

it('카드 제목·내용·순서와 직무·매장·지원서 설정을 보존하고 현재 작성자의 새 초안을 만든다', async () => {
  const response = await request()
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ posting: { id: 'copy' } })
  expect(prisma.hiringPosting.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'source', spaceId: 'space-qa' } })
  )
  const data = tx.hiringPosting.create.mock.calls[0][0].data
  expect(data).toMatchObject({
    title: '원본 (복사)',
    status: 'DRAFT',
    closingDate: null,
    authorUserId: 'current-user',
    applicationEntries: source.applicationEntries,
    notificationEnabled: false,
  })
  for (const key of ['uuid', 'publishedAt', 'applications', 'managerNameEnc'])
    expect(data).not.toHaveProperty(key)
  expect(tx.hiringContent.createMany).toHaveBeenCalledWith({
    data: [{ ...source.contents[0], postingId: 'copy' }],
  })
  expect(tx.hiringPostingPosition.createMany).toHaveBeenCalledWith({
    data: [
      expect.objectContaining({
        postingId: 'copy',
        positionId: 'position',
        name: '직무',
        payAmount: 12000,
        workDays: [1, 2],
      }),
    ],
  })
  expect(tx.hiringPostingStore.createMany).toHaveBeenCalledWith({
    data: [{ postingId: 'copy', storeId: 'store' }],
  })
})

it('원본이 현재 공간에 없으면 생성 트랜잭션을 시작하지 않는다', async () => {
  ;(prisma.hiringPosting.findFirst as jest.Mock).mockResolvedValue(null)
  expect((await request()).status).toBe(404)
  expect(prisma.$transaction).not.toHaveBeenCalled()
})

it('인증 오류가 있으면 원본을 조회하지 않는다', async () => {
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({
    error: Response.json({}, { status: 401 }),
  })
  expect((await request()).status).toBe(401)
  expect(prisma.hiringPosting.findFirst).not.toHaveBeenCalled()
})
