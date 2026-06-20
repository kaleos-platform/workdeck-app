/** @jest-environment node */

import { NextRequest } from 'next/server'

const findManyMock = jest.fn()
const countMock = jest.fn()
const queryRawUnsafeMock = jest.fn()

jest.mock('@/lib/api-helpers', () => ({
  resolveWorkspace: jest.fn(async () => ({ workspace: { id: 'workspace-1' } })),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    adRecord: {
      count: (...args: unknown[]) => countMock(...args),
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafeMock(...args),
  },
}))

import { GET } from '@/app/api/campaigns/[campaignId]/records/route'

describe('GET campaign records', () => {
  test('광고 지면 목록은 DB DISTINCT query로 조회한다', async () => {
    countMock.mockResolvedValue(0)
    findManyMock.mockResolvedValue([])
    queryRawUnsafeMock.mockResolvedValue([{ placement: '검색 영역' }, { placement: '상품 영역' }])

    const response = (await GET(
      new NextRequest(
        'http://localhost/api/campaigns/campaign-1/records?from=2026-05-01&to=2026-05-07'
      ),
      { params: Promise.resolve({ campaignId: 'campaign-1' }) }
    ))!
    const body = (await response.json()) as { placements: string[] }

    expect(body.placements).toEqual(['검색 영역', '상품 영역'])
    expect(queryRawUnsafeMock).toHaveBeenCalledTimes(1)
    expect(findManyMock).toHaveBeenCalledTimes(1)
  })
})
