import { fireEvent, render, screen } from '@testing-library/react'
import { Sidebar } from '../sidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/d/recruiting/postings/abc',
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signOut: jest.fn() }) }))

it('모집 관리 사이드바는 모집·설정 섹션으로 묶고 현재 섹션을 펼친다', () => {
  render(<Sidebar variant="recruiting" mobile />)
  expect(screen.getByRole('button', { name: '모집' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '설정' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('link', { name: '공고 관리' })).toHaveAttribute(
    'href',
    '/d/recruiting/postings'
  )
  expect(screen.queryByRole('link', { name: '공고 템플릿' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  expect(screen.getByRole('link', { name: '공고 템플릿' })).toHaveAttribute(
    'href',
    '/d/recruiting/templates'
  )
})
