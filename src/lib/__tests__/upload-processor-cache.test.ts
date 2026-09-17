/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    adRecord: { findMany: jest.fn() },
    campaignMeta: { upsert: jest.fn() },
    reportUpload: { update: jest.fn() },
  },
}))
jest.mock('@/lib/excel-parser', () => ({
  parseCsvBuffer: jest.fn(() => [
    { campaignId: 'campaign', campaignName: 'name', date: new Date('2026-05-01') },
  ]),
  detectPeriod: jest.fn(() => ({
    periodStart: new Date('2026-05-01'),
    periodEnd: new Date('2026-05-01'),
  })),
  ColumnValidationError: class extends Error {},
}))
jest.mock('@/lib/coupang-ads/cache', () => ({ invalidateCoupangAdsCache: jest.fn() }))

import { processUpload } from '../upload-processor'
import { prisma } from '@/lib/prisma'
import { invalidateCoupangAdsCache } from '@/lib/coupang-ads/cache'

const params = { workspaceId: 'workspace', fileName: 'report.csv', buffer: new ArrayBuffer(0) }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(prisma.$transaction).mockResolvedValue({ uploadId: 'upload', inserted: 1 })
  jest.mocked(prisma.adRecord.findMany).mockResolvedValue([])
  jest.mocked(prisma.campaignMeta.upsert).mockResolvedValue({} as never)
})

test('트랜잭션 커밋 뒤 metadata 실패도 캐시를 만료하고 원래 오류를 전달한다', async () => {
  const error = new Error('metadata failed')
  jest.mocked(prisma.campaignMeta.upsert).mockRejectedValueOnce(error)
  await expect(processUpload(params)).rejects.toBe(error)
  expect(invalidateCoupangAdsCache).toHaveBeenCalledTimes(1)
  expect(invalidateCoupangAdsCache).toHaveBeenCalledWith('workspace')
})

test('트랜잭션 롤백이면 캐시를 만료하지 않는다', async () => {
  const error = new Error('transaction failed')
  jest.mocked(prisma.$transaction).mockRejectedValueOnce(error)
  await expect(processUpload(params)).rejects.toBe(error)
  expect(invalidateCoupangAdsCache).not.toHaveBeenCalled()
})

test('성공 결과를 유지하고 캐시를 한 번 만료한다', async () => {
  expect(await processUpload(params)).toMatchObject({
    success: true,
    uploadId: 'upload',
    inserted: 1,
  })
  expect(invalidateCoupangAdsCache).toHaveBeenCalledTimes(1)
  expect(invalidateCoupangAdsCache).toHaveBeenCalledWith('workspace')
})
