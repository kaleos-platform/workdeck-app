/** @jest-environment node */
jest.mock('@/lib/prisma', () => ({
  prisma: {
    brand: { findFirst: jest.fn(), findMany: jest.fn() },
    brandProfile: { findMany: jest.fn() },
    product: { findMany: jest.fn() },
    salesContentChannel: { findMany: jest.fn() },
    content: { findFirst: jest.fn() },
    deploymentMetric: { findMany: jest.fn() },
  },
}))
jest.mock('@/lib/mcp/context', () => ({ requireDeck: jest.fn() }))

import { prisma } from '@/lib/prisma'
import { requireDeck } from '@/lib/mcp/context'
import { salesContentTools } from '../sales-content-tools'
import type { McpToolContext } from '../types'

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>
const tool = (n: string) => salesContentTools.find((t) => t.name === n)!
const ctx: McpToolContext = {
  spaceId: 'sp-1',
  actor: { type: 'agent', id: 'ag-1' },
  scopes: ['sc:read'],
  workId: 'wk_1',
  requesterUserId: null,
  requesterSlackUserId: null,
  decryptedCredentialIds: [],
}

beforeEach(() => jest.clearAllMocks())

it('모든 도구가 sales-content 카드 활성 여부를 먼저 확인한다', async () => {
  ;(requireDeck as jest.Mock).mockRejectedValue(
    new Error('sales-content 카드가 활성화되지 않았습니다')
  )
  for (const t of salesContentTools) {
    await expect(t.execute(ctx, { contentId: 'c1' })).rejects.toThrow('활성화되지')
  }
  ;(requireDeck as jest.Mock).mockReset()
})

it('sc_list_brands: 브랜드별 프로필과 공통 프로필을 나눈다', async () => {
  db.brand.findMany.mockResolvedValue([
    { id: 'b1', name: '크림드' },
    { id: 'b2', name: '미닝랩' },
  ])
  db.brandProfile.findMany.mockResolvedValue([
    { brandId: 'b1', companyName: '크림드' },
    { brandId: null, companyName: '의식주의' },
  ])
  const r = (await tool('sc_list_brands').execute(ctx, {})) as {
    brands: { id: string; profile: unknown }[]
    commonProfile: unknown
  }
  expect(r.brands).toEqual([
    { id: 'b1', name: '크림드', profile: { companyName: '크림드' } },
    { id: 'b2', name: '미닝랩', profile: null },
  ])
  expect(r.commonProfile).toEqual({ companyName: '의식주의' })
  expect(db.brand.findMany.mock.calls[0][0].where).toEqual({ spaceId: 'sp-1' })
})

it('sc_list_products: 브랜드는 이 Space 안에서 id 를 먼저, 다음 이름으로 찾는다', async () => {
  db.brand.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'b1' })
  db.product.findMany.mockResolvedValue([])
  await tool('sc_list_products').execute(ctx, { brand: '크림드' })
  expect(db.brand.findFirst.mock.calls[0][0].where).toEqual({ spaceId: 'sp-1', id: '크림드' })
  expect(db.brand.findFirst.mock.calls[1][0].where).toEqual({ spaceId: 'sp-1', name: '크림드' })
  expect(db.product.findMany.mock.calls[0][0].where).toEqual({
    spaceId: 'sp-1',
    brandId: 'b1',
    isActive: true,
  })
})

it('sc_list_products: 다른 Space 브랜드·페르소나 관계는 내보내지 않는다', async () => {
  db.product.findMany.mockResolvedValue([
    { id: 'p1', brand: { id: 'bx', name: '남의브랜드', spaceId: 'sp-2' }, personas: [] },
  ])
  const r = (await tool('sc_list_products').execute(ctx, {})) as { products: { brand: unknown }[] }
  expect(r.products[0].brand).toBeNull()
  expect(db.product.findMany.mock.calls[0][0].select.personas.where).toEqual({
    persona: { spaceId: 'sp-1' },
  })
})

it('sc_list_products: 모르는 브랜드는 사용자 오류', async () => {
  db.brand.findFirst.mockResolvedValue(null)
  await expect(tool('sc_list_products').execute(ctx, { brand: '없는브랜드' })).rejects.toThrow(
    '알 수 없는 브랜드'
  )
})

it('sc_list_channels: 자격증명·config 를 내보내지 않고 연결 여부만 준다', async () => {
  db.salesContentChannel.findMany.mockResolvedValue([
    { id: 'ch1', name: '블로그', _count: { credentials: 1 } },
  ])
  const r = (await tool('sc_list_channels').execute(ctx, {})) as { channels: object[] }
  expect(r.channels).toEqual([{ id: 'ch1', name: '블로그', hasCredential: true }])
  const select = db.salesContentChannel.findMany.mock.calls[0][0].select
  expect(select.config).toBeUndefined()
  expect(select.credentials).toBeUndefined()
})

it('sc_get_content: 다른 Space 콘텐츠는 찾지 못한다', async () => {
  db.content.findFirst.mockResolvedValue(null)
  await expect(tool('sc_get_content').execute(ctx, { contentId: 'c-other' })).rejects.toThrow(
    '찾을 수 없습니다'
  )
  expect(db.content.findFirst.mock.calls[0][0].where).toEqual({ id: 'c-other', spaceId: 'sp-1' })
})

it('sc_get_content: 다른 Space 채널 제거·오류 마스킹·같은 날 성과는 우선순위 1행만 합산', async () => {
  const d = new Date('2026-10-01T00:00:00Z')
  db.content.findFirst.mockResolvedValue({
    id: 'c1',
    channel: { id: 'chx', name: '남의채널', platform: 'X', spaceId: 'sp-2' },
    deployments: [
      {
        id: 'd1',
        errorMessage: 'failed access_token=abc123secretvalue',
        channel: { id: 'ch1', name: '블로그', platform: 'BLOG_NAVER', spaceId: 'sp-1' },
      },
    ],
  })
  db.deploymentMetric.findMany.mockResolvedValue([
    {
      deploymentId: 'd1',
      date: d,
      source: 'BROWSER',
      views: 80,
      likes: 1,
      comments: 0,
      shares: 0,
      externalClicks: 0,
      impressions: null,
    },
    {
      deploymentId: 'd1',
      date: d,
      source: 'MANUAL',
      views: 100,
      likes: 2,
      comments: 0,
      shares: 0,
      externalClicks: 0,
      impressions: null,
    },
  ])
  const r = (await tool('sc_get_content').execute(ctx, { contentId: 'c1' })) as {
    channel: unknown
    deployments: { channel: unknown; errorMessage: string; metrics: { views: number } }[]
  }
  expect(r.channel).toBeNull()
  expect(r.deployments[0].channel).toEqual({ id: 'ch1', name: '블로그', platform: 'BLOG_NAVER' })
  expect(r.deployments[0].errorMessage).not.toContain('abc123secretvalue')
  expect(r.deployments[0].metrics.views).toBe(100)
  expect(db.content.findFirst.mock.calls[0][0].select.deployments.where).toEqual({
    spaceId: 'sp-1',
  })
})
