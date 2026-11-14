import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar } from '../sidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/d/recruiting/postings/abc',
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signOut: jest.fn() }) }))

it('모집 관리 사이드바는 홈·공고 관리·지원자를 최상위에 두고 설정만 섹션으로 묶는다', () => {
  render(<Sidebar workspaceName="합성 공간" variant="recruiting" mobile />)
  expect(screen.queryByRole('button', { name: '모집' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '홈' })).toHaveAttribute('href', '/d/recruiting/home')
  expect(screen.getByRole('link', { name: '지원자' })).toHaveAttribute(
    'href',
    '/d/recruiting/applications'
  )
  expect(screen.getByRole('link', { name: '공고 관리' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings'
  )
  expect(screen.getByRole('button', { name: '설정' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('link', { name: '공고 템플릿' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  expect(screen.getByRole('link', { name: '공고 템플릿' })).toHaveAttribute(
    'href',
    '/d/recruiting/templates'
  )
})
