/**
 * GET /api/sh/keywords/suggest — 추천 풀의 상품 스코프 e2e.
 *
 * 배경: 키워드 마스터는 space 단위 풀이라 필터 없이 쓰면 브라 상품에서 등록한 '50대여성브라'
 * 가 클렌징 패드 상품에도 추천된다(실제 prod 제보). 스코프는 Prisma where 절이라 순수 함수
 * 단위 테스트로는 덮이지 않아 라우트를 직접 import 해 고정한다.
 *
 * throwaway space/user 고유 UUID. afterAll cascade 정리. DB URL 없으면 skip.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/api-helpers', () => {
  const actual = jest.requireActual('@/lib/api-helpers')
  return { __esModule: true, ...actual, resolveDeckContext: jest.fn() }
})

import { resolveDeckContext } from '@/lib/api-helpers'
import { GET } from '../../../../app/api/sh/keywords/suggest/route'

// 다른 e2e 와 겹치지 않는 고유 대역
const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000c1'
const USER_ID = 'e2e00000-0000-4000-8000-0000000000c2'

const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

async function cleanup() {
  await prisma.keywordMasterLink.deleteMany({ where: { keyword: { spaceId: SPACE_ID } } })
  await prisma.keywordMaster.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductOption.deleteMany({ where: { product: { spaceId: SPACE_ID } } })
  await prisma.invProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.invProductGroup.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.brand.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
  await prisma.user.deleteMany({ where: { id: USER_ID } })
}

async function seed() {
  await prisma.space.create({
    data: { id: SPACE_ID, name: 'E2E Suggest Scope', type: 'PERSONAL' },
  })
  await prisma.user.create({
    data: { id: USER_ID, email: 'e2e-suggest-scope@throwaway.test' },
  })

  // InvProduct.groupId 는 non-null — 카테고리를 먼저 만든다.
  const group = await prisma.invProductGroup.create({
    data: { spaceId: SPACE_ID, name: 'E2E 카테고리' },
  })
  const cleansing = await prisma.invProduct.create({
    data: { spaceId: SPACE_ID, groupId: group.id, name: '크림드 선 클렌징 패드' },
  })
  const bra = await prisma.invProduct.create({
    data: { spaceId: SPACE_ID, groupId: group.id, name: '에이엠엘 노와이어 브라' },
  })

  // 1) 브라 상품 전용 키워드 — 클렌징 상품 추천에서 빠져야 한다
  const braKeyword = await prisma.keywordMaster.create({
    data: {
      spaceId: SPACE_ID,
      keyword: '50대여성브라',
      normalized: '50대여성브라',
      despaced: '50대여성브라',
      sortedKey: '50대여성브라',
      type: 'UNCLASSIFIED',
      source: 'INTERNAL',
      status: 'CANDIDATE',
    },
  })
  await prisma.keywordMasterLink.create({
    data: { keywordId: braKeyword.id, productId: bra.id, role: 'SUB' },
  })

  // 2) 어디에도 안 붙은 범용 키워드 — 남아야 한다
  await prisma.keywordMaster.create({
    data: {
      spaceId: SPACE_ID,
      keyword: '물놀이용',
      normalized: '물놀이용',
      despaced: '물놀이용',
      sortedKey: '물놀이용',
      type: 'UNCLASSIFIED',
      source: 'INTERNAL',
      status: 'CANDIDATE',
    },
  })

  // 3) 이 상품에 붙은 키워드 — 남아야 한다
  const mine = await prisma.keywordMaster.create({
    data: {
      spaceId: SPACE_ID,
      keyword: '리무버',
      normalized: '리무버',
      despaced: '리무버',
      sortedKey: '리무버',
      type: 'UNCLASSIFIED',
      source: 'INTERNAL',
      status: 'CANDIDATE',
    },
  })
  await prisma.keywordMasterLink.create({
    data: { keywordId: mine.id, productId: cleansing.id, role: 'SUB' },
  })

  return { cleansingId: cleansing.id }
}

d('GET /api/sh/keywords/suggest — 추천 풀 상품 스코프', () => {
  let cleansingId = ''

  beforeAll(async () => {
    await cleanup()
    const seeded = await seed()
    cleansingId = seeded.cleansingId
    ;(resolveDeckContext as jest.Mock).mockResolvedValue({
      space: { id: SPACE_ID },
      user: { id: USER_ID },
    })
  }, 60_000)

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  }, 60_000)

  it('다른 상품 전용 키워드는 추천하지 않는다', async () => {
    const req = new NextRequest(`http://localhost/api/sh/keywords/suggest?productId=${cleansingId}`)
    const res = await GET(req)
    const body = (await res.json()) as { suggestions: string[] }

    expect(res.status).toBe(200)
    expect(body.suggestions).not.toContain('50대여성브라')
  })

  it('어디에도 연결되지 않은 범용 키워드는 남는다', async () => {
    const req = new NextRequest(`http://localhost/api/sh/keywords/suggest?productId=${cleansingId}`)
    const res = await GET(req)
    const body = (await res.json()) as { suggestions: string[] }

    expect(body.suggestions).toContain('물놀이용')
  })

  it('이 상품에 이미 연결된 키워드는 추천하지 않는다 — 등록된 것으로 본다', async () => {
    // productId 경로는 상품에 keywords 컬럼이 없어 KeywordMasterLink 를 '등록됨'으로 삼는다.
    // 스코프 필터는 이 키워드를 풀에 남기지만, existing 이라 추천에서는 빠진다.
    const req = new NextRequest(`http://localhost/api/sh/keywords/suggest?productId=${cleansingId}`)
    const res = await GET(req)
    const body = (await res.json()) as { suggestions: string[] }

    expect(body.suggestions).not.toContain('리무버')
  })
})
