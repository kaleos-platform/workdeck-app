/** @jest-environment node */
import { NextRequest } from 'next/server'
import { PATCH } from '../route'
import { prisma } from '@/lib/prisma'
import { deletePostingAsset } from '@/lib/hiring/storage'

jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: async () => ({ space: { id: 'space' } }),
  errorResponse: (message: string, status: number) => Response.json({ message }, { status }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: { hiringContent: { findFirst: jest.fn(), update: jest.fn() } },
}))
jest.mock('@/lib/hiring/postings', () => ({
  uploadContentImage: jest.fn().mockResolvedValue('space/postings/post/new.png'),
}))
jest.mock('@/lib/hiring/storage', () => ({
  deletePostingAsset: jest.fn().mockResolvedValue(undefined),
}))

it('이미지 업로드 도중 충돌하면 새 객체를 정리하고 409로 알린다', async () => {
  const version = '2026-10-29T12:00:00.000Z'
  jest
    .mocked(prisma.hiringContent.findFirst)
    .mockResolvedValue({ id: 'block', contentType: 'image', updatedAt: new Date(version) } as never)
  jest.mocked(prisma.hiringContent.update).mockRejectedValue({ code: 'P2025' })
  const request = new NextRequest('http://localhost/content', {
    method: 'PATCH',
    body: JSON.stringify({
      expectedUpdatedAt: version,
      imageBase64: 'cWE=',
      mimeType: 'image/png',
    }),
  })
  const response = await PATCH(request, {
    params: Promise.resolve({ id: 'post', contentId: 'block' }),
  })
  expect(response?.status).toBe(409)
  expect(deletePostingAsset).toHaveBeenCalledWith('space/postings/post/new.png')
})

it('DB 반영 여부를 알 수 없는 오류에서는 이미지 삭제를 보류한다', async () => {
  jest.mocked(deletePostingAsset).mockClear()
  const version = '2026-10-29T12:00:00.000Z'
  jest
    .mocked(prisma.hiringContent.findFirst)
    .mockResolvedValue({ id: 'block', contentType: 'image', updatedAt: new Date(version) } as never)
  jest.mocked(prisma.hiringContent.update).mockRejectedValue(new Error('연결 오류'))
  const request = new NextRequest('http://localhost/content', {
    method: 'PATCH',
    body: JSON.stringify({
      expectedUpdatedAt: version,
      imageBase64: 'cWE=',
      mimeType: 'image/png',
    }),
  })
  await expect(
    PATCH(request, { params: Promise.resolve({ id: 'post', contentId: 'block' }) })
  ).rejects.toThrow('연결 오류')
  expect(deletePostingAsset).not.toHaveBeenCalled()
})

it('같은 밀리초에 연속 저장해도 카드 버전은 반드시 증가한다', async () => {
  const version = '2026-10-29T12:00:00.000Z'
  jest.spyOn(Date, 'now').mockReturnValue(new Date(version).getTime())
  jest
    .mocked(prisma.hiringContent.findFirst)
    .mockResolvedValue({ id: 'block', contentType: 'text', updatedAt: new Date(version) } as never)
  jest.mocked(prisma.hiringContent.update).mockResolvedValue({ id: 'block' } as never)
  const request = new NextRequest('http://localhost/content', {
    method: 'PATCH',
    body: JSON.stringify({ expectedUpdatedAt: version, data: { type: 'doc', content: [] } }),
  })
  const response = await PATCH(request, {
    params: Promise.resolve({ id: 'post', contentId: 'block' }),
  })
  expect(response?.status).toBe(200)
  const update = jest.mocked(prisma.hiringContent.update).mock.calls.at(-1)![0]
  expect(new Date(update.data.updatedAt as Date).getTime()).toBeGreaterThan(
    new Date(version).getTime()
  )
  jest.restoreAllMocks()
})
