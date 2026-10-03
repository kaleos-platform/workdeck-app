/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PATCH, DELETE } from '../route'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 'space-qa' }, user: { id: 'user-qa' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringComment: { findFirst: jest.fn(), update: jest.fn() } },
}))

beforeEach(() => jest.clearAllMocks())

it.each(['PATCH', 'DELETE'])('%s는 같은 지원자의 본인 코멘트를 변경한다', async (method) => {
  ;(prisma.hiringComment.findFirst as jest.Mock).mockResolvedValue({
    id: 'comment-qa',
    userId: 'user-qa',
  })
  ;(prisma.hiringComment.update as jest.Mock).mockResolvedValue({
    id: 'comment-qa',
    content: '수정',
  })
  const req = new NextRequest('http://localhost/api/comments', {
    method,
    ...(method === 'PATCH' ? { body: JSON.stringify({ content: '수정' }) } : {}),
  })
  const response = await (method === 'PATCH' ? PATCH : DELETE)(req, {
    params: Promise.resolve({ id: 'app-qa', commentId: 'comment-qa' }),
  })
  expect(response!.status).toBe(200)
  expect(prisma.hiringComment.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'comment-qa', applicationId: 'app-qa', spaceId: 'space-qa', deletedAt: null },
    })
  )
  expect(prisma.hiringComment.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'comment-qa' } })
  )
})

it.each(['PATCH', 'DELETE'])('%s는 다른 지원자 경로의 코멘트를 변경하지 않는다', async (method) => {
  ;(prisma.hiringComment.findFirst as jest.Mock).mockImplementation(async ({ where }) =>
    where.applicationId === 'other-app' ? null : { id: 'comment-qa', userId: 'user-qa' }
  )
  ;(prisma.hiringComment.update as jest.Mock).mockResolvedValue({ id: 'comment-qa' })
  const req = new NextRequest('http://localhost/api/comments', {
    method,
    ...(method === 'PATCH' ? { body: JSON.stringify({ content: '수정' }) } : {}),
  })
  const response = await (method === 'PATCH' ? PATCH : DELETE)(req, {
    params: Promise.resolve({ id: 'other-app', commentId: 'comment-qa' }),
  })
  expect(response!.status).toBe(404)
  expect(prisma.hiringComment.update).not.toHaveBeenCalled()
})

it('올바른 지원자·공간에 속해도 다른 작성자의 코멘트는 거부한다', async () => {
  ;(prisma.hiringComment.findFirst as jest.Mock).mockResolvedValue({
    id: 'comment-qa',
    userId: 'other-user',
  })
  const response = await DELETE(
    new NextRequest('http://localhost/api/comments', { method: 'DELETE' }),
    { params: Promise.resolve({ id: 'app-qa', commentId: 'comment-qa' }) }
  )
  expect(response!.status).toBe(403)
  expect(prisma.hiringComment.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'comment-qa', applicationId: 'app-qa', spaceId: 'space-qa', deletedAt: null },
    })
  )
  expect(prisma.hiringComment.update).not.toHaveBeenCalled()
})
