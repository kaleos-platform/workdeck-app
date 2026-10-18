/** @jest-environment node */
import { prisma } from '@/lib/prisma'
import { findBrandProfileForProducts, saveBrandProfile } from '../brand-profile'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    product: { findFirst: jest.fn() },
    brandProfile: { findFirst: jest.fn() },
  },
}))
const mock = prisma as unknown as {
  product: { findFirst: jest.Mock }
  brandProfile: { findFirst: jest.Mock }
}

function fakeTx() {
  return {
    $queryRaw: jest.fn(),
    brandProfile: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  }
}

beforeEach(() => jest.clearAllMocks())

describe('saveBrandProfile', () => {
  test('브랜드 프로필은 (spaceId, brandId) unique 로 upsert 한다', async () => {
    const tx = fakeTx()
    await saveBrandProfile(tx as never, 's1', 'b1', { companyName: 'A' })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.brandProfile.upsert).toHaveBeenCalledWith({
      where: { spaceId_brandId: { spaceId: 's1', brandId: 'b1' } },
      create: { spaceId: 's1', brandId: 'b1', companyName: 'A' },
      update: { companyName: 'A' },
    })
  })

  test('공통 프로필은 잠금 뒤 기존 행을 갱신한다(NULL 은 unique 로 막히지 않음)', async () => {
    const tx = fakeTx()
    tx.brandProfile.findFirst.mockResolvedValue({ id: 'p1' })
    await saveBrandProfile(tx as never, 's1', null, { logoUrl: 'u' })
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    expect(tx.brandProfile.findFirst).toHaveBeenCalledWith({
      where: { spaceId: 's1', brandId: null },
      select: { id: true },
    })
    expect(tx.brandProfile.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { logoUrl: 'u' },
    })
    expect(tx.brandProfile.create).not.toHaveBeenCalled()
  })

  test('공통 프로필이 없으면 만들고, 회사명이 없으면 빈 값으로 채운다', async () => {
    const tx = fakeTx()
    tx.brandProfile.findFirst.mockResolvedValue(null)
    await saveBrandProfile(tx as never, 's1', null, { logoUrl: 'u' })
    expect(tx.brandProfile.create).toHaveBeenCalledWith({
      data: { spaceId: 's1', brandId: null, companyName: '', logoUrl: 'u' },
    })
  })
})

describe('findBrandProfileForProducts', () => {
  test('상품 브랜드 프로필을 우선하고 없으면 공통으로 내려간다', async () => {
    mock.product.findFirst.mockResolvedValue({ brandId: 'b1' })
    await findBrandProfileForProducts('s1', ['p1', 'p2'], { toneOfVoice: true })
    expect(mock.brandProfile.findFirst).toHaveBeenCalledWith({
      where: { spaceId: 's1', OR: [{ brandId: 'b1' }, { brandId: null }] },
      orderBy: { brandId: { sort: 'asc', nulls: 'last' } },
      select: { toneOfVoice: true },
    })
  })

  test('상품이 없거나 브랜드 미지정이면 공통 프로필만 본다', async () => {
    await findBrandProfileForProducts('s1', [], { toneOfVoice: true })
    expect(mock.product.findFirst).not.toHaveBeenCalled()
    expect(mock.brandProfile.findFirst.mock.calls[0][0].where).toEqual({
      spaceId: 's1',
      brandId: null,
    })
  })
})
