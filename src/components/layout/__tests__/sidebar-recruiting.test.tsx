import { render, screen } from '@testing-library/react'
import { Sidebar } from '../sidebar'

let mockPathname = '/d/recruiting/postings/abc'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signOut: jest.fn() }) }))

it('모집 관리 사이드바는 홈·공고 관리·지원자·설정 4개 링크만 최상위에 둔다', () => {
  mockPathname = '/d/recruiting/postings/abc'
  render(<Sidebar variant="recruiting" mobile />)
  expect(screen.getByRole('link', { name: '홈' })).toHaveAttribute('href', '/d/recruiting/home')
  expect(screen.getByRole('link', { name: '공고 관리' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings'
  )
  expect(screen.getByRole('link', { name: '지원자' })).toHaveAttribute(
    'href',
    '/d/recruiting/applications'
  )
  expect(screen.getByRole('link', { name: '설정' })).toHaveAttribute(
    'href',
    '/d/recruiting/settings'
  )
  for (const name of ['공고 템플릿', '메시지 템플릿', '블랙리스트', '장소 관리', '직무 관리']) {
    expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
  }
  expect(screen.queryByRole('button', { name: '설정' })).not.toBeInTheDocument()
})

it('설정 하위 경로에서는 설정 링크가 활성이다', () => {
  mockPathname = '/d/recruiting/settings/positions'
  render(<Sidebar variant="recruiting" mobile />)
  expect(screen.getByRole('link', { name: '설정' }).className).toContain('text-white')
  expect(screen.getByRole('link', { name: '공고 관리' }).className).toContain('text-zinc-400')
})
