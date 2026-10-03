/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { removeApplicantFiles } from '@/lib/hiring/storage'
jest.mock('@/lib/prisma', () => ({
  prisma: {
    hiringUploadSession: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
    hiringApplicationFile: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}))
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/hiring/storage', () => ({ removeApplicantFiles: jest.fn() }))
const id = '00000000-0000-4000-8000-000000000001'
const fileId = '00000000-0000-4000-8000-000000000002'
const path = `space/applications/${id}/${fileId}.pdf`
beforeEach(() => {
  jest.resetAllMocks()
  ;(prisma.hiringUploadSession.findMany as jest.Mock).mockResolvedValueOnce([
    {
      id,
      spaceId: 'space',
      files: [
        {
          id: fileId,
          fieldKey: 'resume',
          fileName: '합성.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 10,
          path,
        },
      ],
    },
  ])
  ;(prisma.hiringUploadSession.findMany as jest.Mock).mockResolvedValue([])
  ;(prisma.hiringUploadSession.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 1 })
  ;(prisma.hiringApplicationFile.count as jest.Mock).mockResolvedValue(0)
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma))
})
async function run() {
  return GET(new NextRequest('http://localhost/api/cron/hiring-upload-sweep'))
}
it('서명 수명이 끝난 미완료 세션만 조회하고 객체 제거 후 세션을 지운다', async () => {
  expect(await run()).toMatchObject({ deleted: 1, failed: 0 })
  const where = (prisma.hiringUploadSession.findMany as jest.Mock).mock.calls[0][0].where
  expect(where.completedAt).toBeNull()
  expect(where.createdAt.lt.getTime()).toBeLessThan(Date.now() - 2 * 60 * 60 * 1000)
  expect(removeApplicantFiles).toHaveBeenCalledWith([path])
  expect(prisma.hiringUploadSession.delete).toHaveBeenCalledTimes(1)
})
it('완료 처리와 경합하여 잠금을 얻지 못하면 객체를 지우지 않는다', async () => {
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  expect(await run()).toMatchObject({ deleted: 0 })
  expect(removeApplicantFiles).not.toHaveBeenCalled()
})
it('지원서가 참조하는 파일은 지우지 않는다', async () => {
  ;(prisma.hiringApplicationFile.count as jest.Mock).mockResolvedValue(1)
  expect(await run()).toMatchObject({ deleted: 0, failed: 1 })
  expect(removeApplicantFiles).not.toHaveBeenCalled()
  expect(prisma.hiringUploadSession.delete).not.toHaveBeenCalled()
})
it('Storage 실패 시 원장을 남겨 재시도한다', async () => {
  ;(removeApplicantFiles as jest.Mock).mockRejectedValue(Error('failed'))
  expect(await run()).toMatchObject({ deleted: 0, failed: 1 })
  expect(prisma.hiringUploadSession.delete).not.toHaveBeenCalled()
})

it('첫 배치 실패 뒤에도 다음 배치를 처리하고 재시도 시각을 남긴다', async () => {
  const rows = await (prisma.hiringUploadSession.findMany as jest.Mock)()
  ;(prisma.hiringUploadSession.findMany as jest.Mock)
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce(rows)
    .mockResolvedValue([])
  ;(removeApplicantFiles as jest.Mock)
    .mockRejectedValueOnce(Error('failed'))
    .mockResolvedValue(undefined)
  expect(await run()).toMatchObject({ scanned: 2, deleted: 1, failed: 1 })
  expect(prisma.hiringUploadSession.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ data: { claimedAt: expect.any(Date) } })
  )
})
