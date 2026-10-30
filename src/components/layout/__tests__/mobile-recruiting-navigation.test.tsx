import { act, fireEvent, render, screen } from '@testing-library/react'
import { MobileRecruitingNavigation } from '../mobile-recruiting-navigation'

let mockPathname = '/d/recruiting'
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }))
jest.mock('../sidebar', () => ({
  Sidebar: () => <a href="https://example.invalid/applications">지원자</a>,
}))

it('모바일 메뉴를 열고 항목을 선택하면 메뉴를 닫는다', () => {
  render(<MobileRecruitingNavigation workspaceName="합성 공간" />)
  expect(screen.queryByRole('link', { name: '지원자' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 메뉴 열기' }))
  expect(screen.getByRole('dialog', { name: '모집 관리 메뉴' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('link', { name: '지원자' }))
  expect(screen.queryByRole('dialog', { name: '모집 관리 메뉴' })).not.toBeInTheDocument()
})

it('브라우저 이동으로 경로가 바뀌면 열린 메뉴를 닫는다', () => {
  mockPathname = '/d/recruiting'
  const view = render(<MobileRecruitingNavigation workspaceName="합성 공간" />)
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 메뉴 열기' }))
  mockPathname = '/d/recruiting/applications'
  view.rerender(<MobileRecruitingNavigation workspaceName="합성 공간" />)
  expect(screen.queryByRole('dialog', { name: '모집 관리 메뉴' })).not.toBeInTheDocument()
})

it('데스크톱 폭으로 바뀌면 열린 메뉴를 닫는다', () => {
  let change: ((event: { matches: boolean }) => void) | undefined
  window.matchMedia = jest.fn().mockReturnValue({
    addEventListener: (_: string, callback: typeof change) => {
      change = callback
    },
    removeEventListener: jest.fn(),
  })
  render(<MobileRecruitingNavigation workspaceName="합성 공간" />)
  fireEvent.click(screen.getByRole('button', { name: '모집 관리 메뉴 열기' }))
  act(() => {
    change?.({ matches: true })
  })
  expect(screen.queryByRole('dialog', { name: '모집 관리 메뉴' })).not.toBeInTheDocument()
})
