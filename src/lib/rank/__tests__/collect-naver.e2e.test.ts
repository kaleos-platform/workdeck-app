/**
 * collectNaverRanks e2e (dev DB) — 상태 분류·이어받기·예산·슬롯 한도.
 * 네이버 API 는 fetchImpl 주입으로 대체한다(합성 fixture). throwaway space, afterAll 정리.
 */
import path from 'path'
import { config } from 'dotenv'

config({ path: path.resolve(process.cwd(), '.env.local') })

import { prisma } from '@/lib/prisma'
import { collectNaverRanks } from '../collect-naver'
import fixture from './fixtures/naver-shop.json'

const SPACE_ID = 'e2e00000-0000-4000-8000-0000000000fc'
const RUN = !!(process.env.DATABASE_URL || process.env.DIRECT_URL)
const d = RUN ? describe : describe.skip

const KW_A = 'e2e순위A'
const KW_B = 'e2e순위B'
const KW_C = 'e2e순위C'
const OUR_URL = 'https://smartstore.naver.com/ours/products/7777777'

// A: 우리 상품이 7위 / B: 없음 / C: HTTP 500
const fetchImpl = (async (input: string | URL | Request) => {
  const q = decodeURIComponent(new URL(String(input)).searchParams.get('query') ?? '')
  if (q === KW_C) return new Response('', { status: 500 })
  const items = q === KW_A ? fixture.items : fixture.items.slice(0, 6)
  return new Response(JSON.stringify({ items }))
}) as typeof fetch

const base = () => ({
  deadlineMs: Date.now() + 60_000,
  dailyBudget: 10_000,
  slotLimit: 300,
  clientId: 'id',
  clientSecret: 'secret',
  fetchImpl,
})

let mainCp = ''
let badUrlCp = ''
let coupangCp = ''

async function rows() {
  return prisma.keywordRankSnapshot.findMany({
    where: { spaceId: SPACE_ID },
    orderBy: [{ targetKey: 'asc' }, { keyword: 'asc' }],
  })
}
const pick = (all: Awaited<ReturnType<typeof rows>>, cpId: string, keyword: string) =>
  all.find((r) => r.targetKey === `cp:${cpId}` && r.keyword === keyword)

async function cleanup() {
  await prisma.keywordRankSnapshot.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channelProduct.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channel.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.channelTypeDef.deleteMany({ where: { spaceId: SPACE_ID } })
  await prisma.space.deleteMany({ where: { id: SPACE_ID } })
}

d('collectNaverRanks (dev DB)', () => {
  beforeAll(async () => {
    await cleanup()
    await prisma.space.create({ data: { id: SPACE_ID, name: 'E2E Rank Naver', type: 'PERSONAL' } })
    const typeDef = await prisma.channelTypeDef.create({
      data: { spaceId: SPACE_ID, name: 'B2C', isSalesChannel: true },
    })
    const channel = await prisma.channel.create({
      data: { spaceId: SPACE_ID, name: 'E2E 판매채널', channelTypeDefId: typeDef.id },
    })
    const mk = (baseSearchName: string, pageUrl: string, keywords: string[], updatedAt?: Date) =>
      prisma.channelProduct
        .create({
          data: {
            spaceId: SPACE_ID,
            channelId: channel.id,
            baseSearchName,
            pageUrl,
            keywords,
            rankTracking: true,
          },
        })
        .then((cp) =>
          updatedAt
            ? prisma.channelProduct.update({ where: { id: cp.id }, data: { updatedAt } })
            : cp
        )
    mainCp = (await mk('메인', OUR_URL, [KW_A, KW_B, KW_C], new Date('2026-01-01T00:00:00Z'))).id
    badUrlCp = (await mk('매칭불가', 'https://smartstore.naver.com/ours', [KW_A])).id
    coupangCp = (await mk('쿠팡', 'https://www.coupang.com/vp/products/1', [KW_A])).id
  })

  afterAll(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.keywordRankSnapshot.deleteMany({ where: { spaceId: SPACE_ID } })
  })

  it('상태 분류 — RANKED/NOT_IN_TOP100/FAILED/SKIPPED, 쿠팡 URL 은 기록 없음', async () => {
    const s = await collectNaverRanks(base())
    const all = await rows()
    expect(pick(all, mainCp, KW_A)).toMatchObject({ status: 'RANKED', rank: 7, adShown: false })
    expect(pick(all, mainCp, KW_B)).toMatchObject({ status: 'NOT_IN_TOP100', rank: null })
    expect(pick(all, mainCp, KW_C)).toMatchObject({ status: 'FAILED', errorCode: 'HTTP_500' })
    expect(pick(all, badUrlCp, KW_A)).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'UNMATCHABLE_URL',
    })
    expect(all.filter((r) => r.targetKey === `cp:${coupangCp}`)).toHaveLength(0)
    expect(all).toHaveLength(4)
    expect(s).toMatchObject({ targets: 2, calls: 3, ranked: 1, notInTop: 1, failed: 1, skipped: 1 })
  })

  it('재실행은 끝난 행을 다시 쓰지 않고 FAILED 만 재시도한다', async () => {
    await collectNaverRanks(base())
    const s2 = await collectNaverRanks(base())
    expect(await rows()).toHaveLength(4)
    // C 만 다시 호출(여전히 500) — 나머지는 이어받기로 건너뛴다
    expect(s2).toMatchObject({ calls: 1, ranked: 0, notInTop: 0, failed: 1, skipped: 0 })
  })

  it('같은 날 FAILED 는 다음 실행에서 성공하면 결과로 바뀐다', async () => {
    await collectNaverRanks(base())
    const recovered = (async () =>
      new Response(JSON.stringify({ items: fixture.items }))) as unknown as typeof fetch
    await collectNaverRanks({ ...base(), fetchImpl: recovered })
    const all = await rows()
    expect(pick(all, mainCp, KW_C)).toMatchObject({ status: 'RANKED', rank: 7, errorCode: null })
    expect(all).toHaveLength(4)
  })

  it('연속 3회 실패면 이번 실행을 멈추고 남은 쌍은 쓰지 않는다', async () => {
    const down = (async () => new Response('', { status: 429 })) as unknown as typeof fetch
    const s = await collectNaverRanks({ ...base(), fetchImpl: down })
    const all = await rows()
    expect(s).toMatchObject({ calls: 3, aborted: true })
    expect(all.filter((r) => r.status === 'FAILED')).toHaveLength(3)
    expect(pick(all, badUrlCp, KW_A)).toBeUndefined()
  })

  it('예산 1 — 첫 키워드만 조회하고 나머지는 SKIPPED BUDGET', async () => {
    const s = await collectNaverRanks({ ...base(), dailyBudget: 1 })
    const all = await rows()
    expect(s).toMatchObject({ calls: 1, budgetExhausted: true })
    expect(pick(all, mainCp, KW_A)?.status).toBe('RANKED')
    expect(pick(all, mainCp, KW_B)).toMatchObject({ status: 'SKIPPED', errorCode: 'BUDGET' })
    expect(pick(all, mainCp, KW_C)).toMatchObject({ status: 'SKIPPED', errorCode: 'BUDGET' })
  })

  it('슬롯 한도 2 — 초과 쌍은 SKIPPED SLOT_LIMIT', async () => {
    await collectNaverRanks({ ...base(), slotLimit: 2 })
    const all = await rows()
    // 메인 CP(updatedAt 가장 오래됨)가 먼저 슬롯 2개(A,B)를 채우고 C 와 매칭불가 CP 가 초과
    expect(pick(all, mainCp, KW_A)?.status).toBe('RANKED')
    expect(pick(all, mainCp, KW_B)?.status).toBe('NOT_IN_TOP100')
    expect(pick(all, mainCp, KW_C)).toMatchObject({ status: 'SKIPPED', errorCode: 'SLOT_LIMIT' })
    expect(pick(all, badUrlCp, KW_A)).toMatchObject({ status: 'SKIPPED', errorCode: 'SLOT_LIMIT' })
  })
})
