import { render, screen } from '@testing-library/react'
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
jest.mock('@/components/hiring-public/apply-form', () => ({ ApplyForm: () => null }))

const props = { params: Promise.resolve({ uuid: 'qa' }), searchParams: Promise.resolve({}) }
const base = {
  status: 'ACTIVE',
  title: '매장 직원 모집',
  spaceId: 's',
  closingDate: null,
  applicationEntries: null,
  positions: [{ id: 'p1', name: '바리스타', spaceId: 's' }],
  stores: [{ store: { id: 'st1', name: '강남점', spaceId: 's' } }],
}

it('공고명 아래에 직무·장소·마감일을 표시한다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue({
    ...base,
    closingDate: new Date('2099-12-31T00:00:00Z'),
  } as never)
  render(await Page(props))
  expect(screen.getByText('바리스타')).toBeInTheDocument()
  expect(screen.getByText('강남점')).toBeInTheDocument()
  expect(screen.getByText('2099.12.31 마감')).toBeInTheDocument()
})

it('장소가 없으면 행을 생략하고 마감일이 없으면 상시 모집으로 표시한다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue({ ...base, stores: [] } as never)
  render(await Page(props))
  expect(screen.queryByText('모집 장소')).not.toBeInTheDocument()
  expect(screen.getByText('상시 모집')).toBeInTheDocument()
})

it('다른 Space 의 직무·장소는 헤더에 노출하지 않는다', async () => {
  jest.mocked(prisma.hiringPosting.findUnique).mockResolvedValue({
    ...base,
    positions: [...base.positions, { id: 'p2', name: '타사 직무', spaceId: 'other' }],
    stores: [...base.stores, { store: { id: 'st2', name: '타사 매장', spaceId: 'other' } }],
  } as never)
  render(await Page(props))
  expect(screen.getByText('바리스타')).toBeInTheDocument()
  expect(screen.queryByText(/타사/)).not.toBeInTheDocument()
})
