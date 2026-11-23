import { render } from '@testing-library/react'
import Page from '../page'
import { prisma } from '@/lib/prisma'

jest.mock('@/lib/prisma', () => ({
  prisma: { hiringPosting: { findUnique: jest.fn() }, spaceMember: { findFirst: jest.fn() } },
}))
jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw Error('404')
  },
}))

const props = {
  params: Promise.resolve({ uuid: 'qa' }),
  searchParams: Promise.resolve({}),
}
const formButton = {
  id: 'b',
  spaceId: 's',
  contentType: 'button',
  data: { title: '지원하기', linkType: 'form' },
}
const positionsBlock = { id: 'p', spaceId: 's', contentType: 'positions', data: null }
const posting = (over: Record<string, unknown> = {}) => ({
  status: 'ACTIVE',
  uuid: 'qa',
  title: '바리스타 모집',
  spaceId: 's',
  space: { name: '카페' },
  closingDate: null,
  publishedAt: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  positions: [
    {
      id: 'pp',
      spaceId: 's',
      name: '바리스타',
      jobType: 'PART_TIME',
      payFrequency: 'HOURLY',
      payAmount: 11000,
      workDays: null,
      workStartAt: null,
      workEndAt: null,
      headcount: null,
      experience: null,
      education: null,
      jobDescription: '커피 제조',
    },
  ],
  stores: [{ store: { name: '본점', roadAddress: '서울 강남구 테헤란로 1', spaceId: 's' } }],
  contents: [positionsBlock, formButton],
  ...over,
})

const load = async (p: unknown) => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue(p as never)
  return render(await Page(props)).container
}
const ld = (c: HTMLElement) => c.querySelectorAll('script[type="application/ld+json"]')

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.HIRING_PUBLIC_POWERED_BY
})

describe('공개 공고 JobPosting', () => {
  it('ACTIVE 공고는 JSON-LD 와 매장 도로명 주소를 낸다', async () => {
    const c = await load(posting())
    expect(ld(c)).toHaveLength(1)
    expect(JSON.parse(ld(c)[0].textContent as string)['@type']).toBe('JobPosting')
    expect(c.textContent).toContain('본점 (서울 강남구 테헤란로 1)')
  })

  it('다른 공간에 연결된 포지션·매장은 JSON-LD 에 반영되지 않는다', async () => {
    const p = posting()
    p.positions.push({ ...p.positions[0], id: 'x', spaceId: 'other', name: '타공간' })
    p.stores.push({ store: { name: '타매장', roadAddress: '부산 1', spaceId: 'other' } })
    const c = await load(p)
    const text = ld(c)[0].textContent as string
    expect(text).not.toContain('타공간')
    expect(text).not.toContain('부산')
    expect(c.textContent).not.toContain('타매장')
  })

  it('다른 공간 매장만 있으면(주소 없음) 내지 않는다', async () => {
    const c = await load(
      posting({ stores: [{ store: { name: '타', roadAddress: '부산 1', spaceId: 'other' } }] })
    )
    expect(ld(c)).toHaveLength(0)
  })

  it('외부 링크 버튼만 있으면 내지 않는다', async () => {
    const ext = { ...formButton, data: { title: '외부', linkType: 'url', url: 'https://x.test' } }
    expect(ld(await load(posting({ contents: [positionsBlock, ext] })))).toHaveLength(0)
  })

  it('positions 블록이 없으면 내지 않는다', async () => {
    expect(ld(await load(posting({ contents: [formButton] })))).toHaveLength(0)
  })

  it('CLOSED·마감 경과는 내지 않는다', async () => {
    expect(ld(await load(posting({ status: 'CLOSED' })))).toHaveLength(0)
    expect(ld(await load(posting({ closingDate: new Date('2020-01-01T00:00:00Z') })))).toHaveLength(
      0
    )
  })
})

describe('공개 공고 하단 링크', () => {
  it('기본 표시: utm 링크, 새 탭, noopener', async () => {
    const a = (await load(posting())).querySelector('footer a') as HTMLAnchorElement
    expect(a.getAttribute('href')).toMatch(
      /\/recruiting\?utm_source=job_page&utm_medium=referral&utm_campaign=public_posting$/
    )
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener')
  })

  it('HIRING_PUBLIC_POWERED_BY=off 이면 숨긴다', async () => {
    process.env.HIRING_PUBLIC_POWERED_BY = 'off'
    expect((await load(posting())).querySelector('footer a')).toBeNull()
  })
})
