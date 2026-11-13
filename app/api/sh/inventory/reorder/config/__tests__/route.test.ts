/** @jest-environment node */
import { NextRequest } from 'next/server'
import { GET, PATCH } from '../[productId]/route'
import { prisma } from '@/lib/prisma'
import { resolveDeckContext } from '@/lib/api-helpers'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { ...actual, resolveDeckContext: jest.fn() }
})
jest.mock('@/lib/prisma', () => ({
  prisma: {
    invProduct: { findFirst: jest.fn() },
    invReorderConfig: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}))

const product = prisma.invProduct as unknown as { findFirst: jest.Mock }
const config = prisma.invReorderConfig as unknown as { findUnique: jest.Mock; upsert: jest.Mock }
const params = { params: Promise.resolve({ productId: 'p1' }) }
const patch = async (body: unknown) =>
  (await PATCH(
    new NextRequest('http://localhost/api', { method: 'PATCH', body: JSON.stringify(body) }),
    params
  ))!

beforeEach(() => {
  jest.resetAllMocks()
  ;(resolveDeckContext as jest.Mock).mockResolvedValue({ space: { id: 's1' } })
  product.findFirst.mockResolvedValue({ id: 'p1' })
  config.findUnique.mockResolvedValue(null)
  config.upsert.mockImplementation(async ({ create }) => ({ ...create }))
})

describe('발주 설정 API', () => {
  it('GET 기본값 30/false/null', async () => {
    const res = (await GET(new NextRequest('http://localhost/api'), params))!
    const json = await res.json()
    expect(json).toMatchObject({
      targetCoverDays: 30,
      excludeFromForecast: false,
      forecastModel: null,
    })
  })

  it('PATCH 세 필드를 upsert에 전달', async () => {
    const res = await patch({
      targetCoverDays: 45,
      excludeFromForecast: true,
      forecastModel: 'MA90',
    })
    expect(res.status).toBe(200)
    const arg = config.upsert.mock.calls[0][0]
    for (const k of ['create', 'update']) {
      expect(arg[k]).toMatchObject({
        targetCoverDays: 45,
        excludeFromForecast: true,
        forecastModel: 'MA90',
      })
    }
    expect(await res.json()).toMatchObject({
      targetCoverDays: 45,
      excludeFromForecast: true,
      forecastModel: 'MA90',
    })
  })

  it('targetCoverDays 범위·정수 위반은 400', async () => {
    for (const v of [0, 366, 1.5, 'x'])
      expect((await patch({ targetCoverDays: v })).status).toBe(400)
  })

  it('forecastModel 잘못된 값은 400, null은 허용', async () => {
    expect((await patch({ forecastModel: 'XX' })).status).toBe(400)
    expect((await patch({ forecastModel: null })).status).toBe(200)
    expect(config.upsert.mock.calls[0][0].update.forecastModel).toBeNull()
  })

  it('excludeFromForecast 비불리언은 400', async () => {
    expect((await patch({ excludeFromForecast: 'yes' })).status).toBe(400)
  })
})
