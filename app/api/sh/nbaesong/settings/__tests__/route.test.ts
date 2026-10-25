jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}))
jest.mock('@/lib/api-helpers', () => ({
  resolveDeckContext: jest.fn().mockResolvedValue({ space: { id: 'space-1' } }),
}))
jest.mock('@/lib/prisma', () => ({
  prisma: {
    spaceCredential: { findUnique: jest.fn() },
    channel: { findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { GET } from '../route'

const findCred = jest.mocked(prisma.spaceCredential.findUnique)
const findChannels = jest.mocked(prisma.channel.findMany)

describe('GET /api/sh/nbaesong/settings', () => {
  test('설정만 돌려주고 시크릿 필드는 없다', async () => {
    findCred.mockResolvedValue({
      config: {
        locationId: 'loc-1',
        stores: [
          {
            key: 'shop1',
            label: '스토어1',
            startDate: '2026-10-01',
            representativeChannelId: 'rep-1',
            backfilledThrough: '2026-10-24',
          },
        ],
      },
      lastError: '마지막 오류',
      // 실제 select 에는 없지만 새어 나가는지 확인하기 위해 심어 둔다.
      encryptedPayload: 'SECRET',
      iv: 'IV',
    } as never)
    findChannels.mockResolvedValue([
      { id: 'nb-1', externalSource: 'naver_nbaesong:shop1' },
    ] as never)

    const res = (await GET())!
    const body = await res.json()
    expect(body).toEqual({
      configured: true,
      locationId: 'loc-1',
      stores: [
        {
          key: 'shop1',
          label: '스토어1',
          startDate: '2026-10-01',
          representativeChannelId: 'rep-1',
          backfilledThrough: '2026-10-24',
          channelId: 'nb-1',
        },
      ],
      lastError: '마지막 오류',
    })
    expect(JSON.stringify(body)).not.toMatch(/SECRET|clientSecret|clientId|encryptedPayload/)
    expect(findCred.mock.calls[0][0]?.select).toEqual({ config: true, lastError: true })
  })

  test('미설정이면 configured=false', async () => {
    findCred.mockResolvedValue(null)
    const body = await (await GET())!.json()
    expect(body).toEqual({ configured: false, locationId: null, stores: [], lastError: null })
  })
})
