/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET } from '../route'
import { prisma } from '@/lib/prisma'
import { removeApplicantFiles } from '@/lib/hiring/storage'
jest.mock('@/lib/cron/with-cron-run', () => ({ withCronRun: (_: string, fn: unknown) => fn }))
jest.mock('@/lib/hiring/storage', () => ({ removeApplicantFiles: jest.fn() }))
jest.mock('@/lib/prisma', () => ({ prisma: {
  hiringUploadSession: { findMany: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(),
} }))

it('v1 claim이 무효화되면 파일을 지우지 않으며 같은 행을 상한까지 반복한다', async () => {
  ;(prisma.hiringUploadSession.findMany as jest.Mock).mockResolvedValue([{ id: 'synthetic' }])
  ;(prisma.hiringUploadSession.updateMany as jest.Mock).mockResolvedValue({ count: 0 })
  ;(prisma.hiringUploadSession.count as jest.Mock).mockResolvedValue(1)
  ;(prisma.$transaction as jest.Mock).mockImplementation((fn) => fn(prisma))
  const result = await GET(new NextRequest('http://localhost/cron'))
  expect(result).toMatchObject({ scanned: 500, deleted: 0, failed: 0, remaining: 1, truncated: true })
  expect(prisma.hiringUploadSession.findMany).toHaveBeenCalledTimes(500)
  expect(removeApplicantFiles).not.toHaveBeenCalled()
})
