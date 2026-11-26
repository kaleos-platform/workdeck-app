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

const props = { params: Promise.resolve({ uuid: 'qa' }), searchParams: Promise.resolve({}) }
const profile = (over: Record<string, unknown> = {}) => ({
  companyName: '미닝카페',
  intro: '첫째 줄\n둘째 줄',
  homepageUrl: 'https://meaning.example',
  blogUrl: null,
  instagramUrl: 'https://instagram.com/meaning',
  youtubeUrl: null,
  showIntro: true,
  ...over,
})
const store = (name: string, roadAddress: string | null, spaceId = 's') => ({
  store: { name, roadAddress, spaceId },
})
const posting = (hiringCompanyProfile: unknown, stores = [store('본점', '서울 강남구 1')]) => ({
  status: 'ACTIVE',
  uuid: 'qa',
  title: '바리스타 모집',
  spaceId: 's',
  space: { hiringCompanyProfile },
  closingDate: null,
  positions: [],
  stores,
  contents: [],
})
const load = async (p: unknown) => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue(p as never)
  return render(await Page(props)).container
}

beforeEach(() => jest.clearAllMocks())

it('프로필이 없으면 기업명·푸터가 없고 주소는 머리글에 남는다', async () => {
  const c = await load(posting(null))
  expect(c.querySelector('header')?.textContent).toContain('본점 (서울 강남구 1)')
  expect(c.textContent).not.toContain('근무 장소')
  expect(c.textContent).not.toContain('미닝카페')
})

it('기업명만 저장해도 근무 장소 주소가 표시된다', async () => {
  const c = await load(posting(profile({ intro: null, homepageUrl: null, instagramUrl: null })))
  expect(c.querySelector('header')?.textContent).toContain('미닝카페')
  expect(c.textContent).toContain('근무 장소')
  expect(c.textContent).toContain('본점 — 서울 강남구 1')
  expect(c.querySelectorAll('section a')).toHaveLength(0)
})

it('여러 장소는 머리글에 「외 n곳」, 푸터에 주소 전부', async () => {
  const c = await load(
    posting(profile(), [
      store('본점', '서울 1'),
      store('2호점', '서울 2'),
      store('3호점', '서울 3'),
    ])
  )
  expect(c.querySelector('header')?.textContent).toContain('본점 외 2곳')
  for (const t of ['본점 — 서울 1', '2호점 — 서울 2', '3호점 — 서울 3'])
    expect(c.textContent).toContain(t)
})

it('showIntro=false 면 소개·링크는 숨기고 근무 장소 주소는 남는다', async () => {
  const c = await load(posting(profile({ showIntro: false })))
  expect(c.textContent).not.toContain('첫째 줄')
  expect(c.querySelectorAll('section a')).toHaveLength(0)
  expect(c.textContent).toContain('본점 — 서울 강남구 1')
})

it('링크는 새 탭 + noopener noreferrer nofollow, 값 있는 것만 렌더', async () => {
  const c = await load(posting(profile()))
  const links = Array.from(c.querySelectorAll<HTMLAnchorElement>('section a'))
  expect(links.map((a) => a.textContent)).toEqual(['홈페이지', '인스타그램'])
  for (const a of links) {
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener noreferrer nofollow')
  }
  expect(c.textContent).toContain('첫째 줄')
})

it('다른 공간에 연결된 장소는 푸터에도 나오지 않는다', async () => {
  const c = await load(
    posting(profile(), [store('본점', '서울 1'), store('타 공간', '부산 9', 'other')])
  )
  expect(c.textContent).not.toContain('부산 9')
})
