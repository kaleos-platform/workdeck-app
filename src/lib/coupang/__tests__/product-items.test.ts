import { upsertCoupangProductItems } from '../product-items'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { coupangProductItem: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() } },
}))

const m = prisma.coupangProductItem as unknown as {
  findMany: jest.Mock
  update: jest.Mock
  create: jest.Mock
}
const row = {
  sellerProductId: 'fake',
  itemName: null,
  rgVendorItemId: 'one' as string | null,
  rgSalePrice: null,
  mpVendorItemId: null as string | null,
  mpSalePrice: null,
  barcode: null,
  skuInfo: null,
  statusName: null,
}

beforeEach(() => {
  m.findMany.mockReset().mockResolvedValue([])
  m.update.mockReset().mockResolvedValue({})
  m.create.mockReset().mockResolvedValue({})
})

test('오류 객체를 보존하고 다음 행을 처리한다', async () => {
  const failure = new Error('가짜 오류')
  m.create.mockRejectedValueOnce(failure)
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const count = await upsertCoupangProductItems('space', [row, { ...row, rgVendorItemId: 'two' }])
    expect(count).toBe(1)
    expect(m.create).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[0][1]).toBe(failure)
  } finally {
    log.mockRestore()
  }
})

test('두 축 중 하나라도 맞는 기존 행이 있으면 그 행을 갱신한다', async () => {
  m.findMany.mockResolvedValueOnce([{ id: 'row-1' }])
  const count = await upsertCoupangProductItems('space', [
    { ...row, rgVendorItemId: 'rg-1', mpVendorItemId: 'mp-1' },
  ])
  expect(count).toBe(1)
  expect(m.findMany.mock.calls[0][0].where).toEqual({
    spaceId: 'space',
    OR: [{ rgVendorItemId: 'rg-1' }, { mpVendorItemId: 'mp-1' }],
  })
  expect(m.update.mock.calls[0][0].where).toEqual({ id: 'row-1' })
  expect(m.update.mock.calls[0][0].data).not.toHaveProperty('listingId')
  expect(m.create).not.toHaveBeenCalled()
})

test('두 축이 서로 다른 기존 행에 걸리면 쓰지 않고 실패로 남긴다', async () => {
  m.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
  const log = jest.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const count = await upsertCoupangProductItems('space', [
      { ...row, rgVendorItemId: 'rg-1', mpVendorItemId: 'mp-1' },
    ])
    expect(count).toBe(0)
    expect(m.update).not.toHaveBeenCalled()
    expect(m.create).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
  } finally {
    log.mockRestore()
  }
})

test('두 축 다 없으면 건너뛴다', async () => {
  const count = await upsertCoupangProductItems('space', [
    { ...row, rgVendorItemId: null, mpVendorItemId: null },
  ])
  expect(count).toBe(0)
  expect(m.findMany).not.toHaveBeenCalled()
})
