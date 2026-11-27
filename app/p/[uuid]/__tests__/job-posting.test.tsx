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
  space: { name: '카페', hiringCompanyProfile: null },
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

const profile = {
  companyName: '미닝랩',
  intro: null,
  homepageUrl: null,
  blogUrl: null,
  instagramUrl: null,
  youtubeUrl: null,
  showIntro: false,
}
const future = new Date('2999-12-31T00:00:00Z')
const jsonLdPosting = (over: Record<string, unknown> = {}) =>
  posting({
    space: { name: '카페', hiringCompanyProfile: profile },
    closingDate: future,
    ...over,
  })

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.HIRING_JOBPOSTING
  delete process.env.HIRING_PUBLIC_POWERED_BY
})

describe('공개 공고 본문', () => {
  it('기업 정보가 없으면 JSON-LD 를 내지 않고 머리글에 도로명 주소를 표시한다', async () => {
    const c = await load(posting({ closingDate: future }))
    expect(ld(c)).toHaveLength(0)
    expect(c.textContent).toContain('본점 (서울 강남구 테헤란로 1)')
  })

  it('다른 공간에 연결된 장소는 표시하지 않는다', async () => {
    const p = posting()
    p.stores.push({ store: { name: '타매장', roadAddress: '부산 1', spaceId: 'other' } })
    const c = await load(p)
    expect(c.textContent).not.toContain('타매장')
    expect(c.textContent).not.toContain('부산')
  })
})

describe('공개 공고 JobPosting JSON-LD', () => {
  it('기업 정보+마감일 미래 → 1개, 회사명=기업명·title=직무명', async () => {
    const c = await load(jsonLdPosting())
    const scripts = ld(c)
    expect(scripts).toHaveLength(1)
    const data = JSON.parse(scripts[0].textContent as string)
    expect(data.hiringOrganization.name).toBe('미닝랩')
    expect(data.title).toBe('바리스타')
    expect(data.title).not.toBe('바리스타 모집')
    expect(data.jobLocation[0].address.addressRegion).toBe('서울')
  })

  it.each([
    ['기업 정보 없음', { space: { name: '카페', hiringCompanyProfile: null } }],
    ['마감일 없음(상시)', { closingDate: null }],
    ['CLOSED', { status: 'CLOSED' }],
    ['마감 경과', { closingDate: new Date('2020-01-01T00:00:00Z') }],
  ])('%s → 0개', async (_n, over) => {
    expect(ld(await load(jsonLdPosting(over)))).toHaveLength(0)
  })

  it('HIRING_JOBPOSTING=off → 0개(화면은 그대로)', async () => {
    process.env.HIRING_JOBPOSTING = 'off'
    const c = await load(jsonLdPosting())
    expect(ld(c)).toHaveLength(0)
    expect(c.textContent).toContain('미닝랩')
  })

  it('다른 공간의 position·store·content 는 JSON-LD·HTML 어디에도 없다', async () => {
    const p = jsonLdPosting()
    p.positions.push({ ...p.positions[0], id: 'x', spaceId: 'other', name: '타공간직무' })
    p.stores.push({ store: { name: '타매장', roadAddress: '부산 타주소 9', spaceId: 'other' } })
    p.contents.push(
      {
        id: 't',
        spaceId: 'other',
        contentType: 'text',
        data: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '타공간본문' }] }],
        },
      } as never,
      {
        id: 'b2',
        spaceId: 'other',
        contentType: 'button',
        data: { title: '타버튼', linkType: 'form' },
      }
    )
    const c = await load(p)
    const all = c.innerHTML + ld(c)[0].textContent
    for (const leaked of ['타공간직무', '타매장', '부산 타주소', '타공간본문', '타버튼']) {
      expect(all).not.toContain(leaked)
    }
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
