import { loadItemResolver } from '../resolve-order-items'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: {
    channelProductAlias: { findMany: jest.fn() },
    productListing: { findMany: jest.fn() },
  },
}))

const aliasFind = prisma.channelProductAlias.findMany as unknown as jest.Mock
const listingFind = prisma.productListing.findMany as unknown as jest.Mock

const alias = (over: Record<string, unknown>) => ({
  aliasName: 'a',
  optionId: null,
  listingId: null,
  fulfillments: [],
  ...over,
})

beforeEach(() => {
  jest.resetAllMocks()
  listingFind.mockResolvedValue([])
})

describe('loadItemResolver', () => {
  it('fulfillments alias: 수량에 주문 수량을 곱한다', async () => {
    aliasFind.mockResolvedValue([alias({ fulfillments: [{ optionId: 'o1', quantity: 2 }] })])
    const r = await loadItemResolver('s', ['c1'], ['a'])
    expect(r('a', 3)).toEqual({
      name: 'a',
      quantity: 3,
      optionId: null,
      listingId: null,
      fulfillments: [{ optionId: 'o1', quantity: 6 }],
    })
  })

  it('listing alias: listing 구성품으로 팬아웃한다', async () => {
    aliasFind.mockResolvedValue([alias({ listingId: 'l1' })])
    listingFind.mockResolvedValue([{ id: 'l1', items: [{ optionId: 'o1', quantity: 2 }] }])
    const r = await loadItemResolver('s', ['c1'], ['a'])
    const item = r('a', 2)
    expect(item.listingId).toBe('l1')
    expect(item.fulfillments).toEqual([{ optionId: 'o1', quantity: 4 }])
  })

  it('option alias', async () => {
    aliasFind.mockResolvedValue([alias({ optionId: 'o9' })])
    const r = await loadItemResolver('s', ['c1'], ['a'])
    expect(r('a', 1).optionId).toBe('o9')
  })

  it('첫 채널에 없으면 다음 채널로 폴백한다', async () => {
    aliasFind.mockImplementation(({ where }: { where: { channelId: string } }) =>
      Promise.resolve(where.channelId === 'c2' ? [alias({ optionId: 'o2' })] : [])
    )
    const r = await loadItemResolver('s', ['c1', 'c2'], ['a'])
    expect(r('a', 1).optionId).toBe('o2')
  })

  it('앞 채널 alias 가 우선한다', async () => {
    aliasFind.mockImplementation(({ where }: { where: { channelId: string } }) =>
      Promise.resolve([alias({ optionId: where.channelId === 'c1' ? 'o1' : 'o2' })])
    )
    const r = await loadItemResolver('s', ['c1', 'c2'], ['a'])
    expect(r('a', 1).optionId).toBe('o1')
  })

  it('미매칭', async () => {
    aliasFind.mockResolvedValue([])
    const r = await loadItemResolver('s', ['c1', 'c2'], ['zzz'])
    expect(r('zzz', 1)).toEqual({
      name: 'zzz',
      quantity: 1,
      optionId: null,
      listingId: null,
      fulfillments: [],
    })
  })
})
