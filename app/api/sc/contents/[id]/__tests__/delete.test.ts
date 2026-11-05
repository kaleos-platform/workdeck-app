/** @jest-environment node */
import { NextRequest } from 'next/server'
import { resolveDeckContext } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { deleteAsset } from '@/lib/supabase/storage'
import { DELETE } from '../route'

jest.mock('@/lib/api-helpers', () => {
  const { NextResponse } = jest.requireActual('next/server')
  return {
    resolveDeckContext: jest.fn(),
    errorResponse: (message: string, status: number) => NextResponse.json({ message }, { status }),
  }
})
jest.mock('@/lib/supabase/storage', () => ({ deleteAsset: jest.fn() }))
jest.mock('@/lib/sc/content-versions', () => ({ snapshotContent: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    content: { findFirst: jest.fn(), delete: jest.fn(() => 'content.delete') },
    salesContentJob: { deleteMany: jest.fn(() => 'job.deleteMany') },
    $transaction: jest.fn(),
  },
}))

const content = prisma.content as unknown as { findFirst: jest.Mock; delete: jest.Mock }
const jobs = prisma.salesContentJob as unknown as { deleteMany: jest.Mock }
const tx = prisma.$transaction as unknown as jest.Mock
const removeFile = deleteAsset as jest.Mock

const del = async () => {
  const res = await DELETE(new NextRequest('http://t/api/sc/contents/c1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'c1' }),
  })
  if (!res) throw new Error('응답이 없습니다')
  return res
}
const found = (over: Record<string, unknown>) =>
  content.findFirst.mockResolvedValue({
    id: 'c1',
    status: 'APPROVED',
    deployments: [],
    assets: [],
    ...over,
  })

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ user: { id: 'u' }, space: { id: 's1' } })
  removeFile.mockResolvedValue(undefined)
})

test('게시된 콘텐츠는 409, 삭제 없음', async () => {
  found({ status: 'PUBLISHED' })
  expect((await del()).status).toBe(409)
  expect(tx).not.toHaveBeenCalled()
})

test('게시 진행 중 배포가 있으면 409, 삭제 없음', async () => {
  found({ deployments: [{ id: 'd1', status: 'PUBLISHING' }] })
  expect((await del()).status).toBe(409)
  expect(tx).not.toHaveBeenCalled()
})

test('대기 job 정리 + 콘텐츠 삭제 + 사진 파일 정리(실패해도 성공)', async () => {
  found({
    status: 'SCHEDULED',
    deployments: [{ id: 'd1', status: 'AWAITING_ASSETS' }],
    assets: [{ storagePath: 'a.png' }, { storagePath: null }, { storagePath: 'b.png' }],
  })
  removeFile.mockRejectedValueOnce(new Error('storage down'))
  const res = await del()
  expect(res.status).toBe(200)
  expect(jobs.deleteMany).toHaveBeenCalledWith({
    where: { spaceId: 's1', targetId: { in: ['d1'] }, status: 'PENDING' },
  })
  expect(tx).toHaveBeenCalledWith(['job.deleteMany', 'content.delete'])
  expect(removeFile.mock.calls).toEqual([['a.png'], ['b.png']])
})
