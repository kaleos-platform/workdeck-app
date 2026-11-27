import sitemap from '../sitemap'
import { prisma } from '@/lib/prisma'
import * as Sentry from '@sentry/nextjs'

jest.mock('@/lib/prisma', () => ({ prisma: { hiringPosting: { findMany: jest.fn() } } }))
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))

const findMany = jest.mocked(prisma.hiringPosting.findMany)
const day = (d: number) => new Date(Date.now() + d * 86400000)
// 날짜값(UTC 자정)
const dateOnly = (d: number) => new Date(day(d).toISOString().slice(0, 10) + 'T00:00:00Z')

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.HIRING_JOBPOSTING
})

describe('/p/sitemap.xml', () => {
  it('조회 조건: 기업 정보·마감일·발행 여부·ACTIVE 또는 최근 CLOSED, 50000건 한도', async () => {
    findMany.mockResolvedValue([])
    await sitemap()
    const arg = findMany.mock.calls[0][0] as never as {
      where: Record<string, unknown> & { OR: { status: string }[] }
      take: number
    }
    expect(arg.where.space).toEqual({ hiringCompanyProfile: { isNot: null } })
    expect(arg.where.closingDate).toEqual({ not: null })
    expect(arg.where.publishedAt).toEqual({ not: null })
    expect(arg.where.OR.map((o) => o.status)).toEqual(['ACTIVE', 'CLOSED'])
    expect(arg.take).toBe(50000)
  })

  it('마감 전 ACTIVE 는 updatedAt, 미래 날짜 없음', async () => {
    const updatedAt = day(-3)
    findMany.mockResolvedValue([{ uuid: 'a', closingDate: dateOnly(10), updatedAt }] as never)
    const [entry] = await sitemap()
    expect(entry.url).toMatch(/\/p\/a$/)
    expect(entry.lastModified).toEqual(updatedAt)
  })

  it('마감 경과 공고는 마감 시각(KST 23:59:59)과 updatedAt 중 늦은 값', async () => {
    const closing = dateOnly(-5)
    const recentUpdate = day(-1)
    findMany.mockResolvedValue([
      { uuid: 'late', closingDate: closing, updatedAt: day(-20) },
      { uuid: 'later', closingDate: closing, updatedAt: recentUpdate },
    ] as never)
    const [a, b] = await sitemap()
    expect(a.lastModified).toEqual(new Date(closing.getTime() + 15 * 3600000 - 1000))
    expect(b.lastModified).toEqual(recentUpdate)
    for (const e of [a, b])
      expect((e.lastModified as Date).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('조기 CLOSED(마감일 미래)도 미래 날짜를 쓰지 않는다', async () => {
    const updatedAt = day(-1)
    findMany.mockResolvedValue([{ uuid: 'c', closingDate: dateOnly(30), updatedAt }] as never)
    expect((await sitemap())[0].lastModified).toEqual(updatedAt)
  })

  it('HIRING_JOBPOSTING=off 이면 모든 항목 lastmod 를 요청 시각으로', async () => {
    process.env.HIRING_JOBPOSTING = 'off'
    findMany.mockResolvedValue([
      { uuid: 'a', closingDate: dateOnly(10), updatedAt: day(-30) },
    ] as never)
    const before = Date.now()
    const [entry] = await sitemap()
    expect((entry.lastModified as Date).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('DB 오류 → 빈 배열 + Sentry', async () => {
    const err = new Error('db')
    findMany.mockRejectedValue(err)
    expect(await sitemap()).toEqual([])
    expect(Sentry.captureException).toHaveBeenCalledWith(err)
  })
})
