import { upsertCoupangProductItems } from '../product-items'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { coupangProductItem: { upsert: jest.fn() } },
}))

test('오류 객체를 보존하고 다음 행을 처리한다', async () => {
  const failure = new Error('가짜 오류')
  const upsert = jest.mocked(prisma.coupangProductItem.upsert)
  upsert.mockReset()
  upsert.mockRejectedValueOnce(failure).mockResolvedValueOnce({} as never)
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  const row = {
    sellerProductId: 'fake',
    itemName: null,
    rgVendorItemId: 'one',
    rgSalePrice: null,
    mpVendorItemId: null,
    mpSalePrice: null,
    barcode: null,
    skuInfo: null,
    statusName: null,
  }

  try {
    const count = await upsertCoupangProductItems('space', [row, { ...row, rgVendorItemId: 'two' }])
    expect(count).toBe(1)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][1]).toBe(failure)
  } finally {
    log.mockRestore()
  }
})
