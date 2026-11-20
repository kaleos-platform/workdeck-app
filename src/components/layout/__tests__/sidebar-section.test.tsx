import { fireEvent, render, screen } from '@testing-library/react'
import { Settings } from 'lucide-react'
import { SidebarSection } from '../sidebar-section'

let mockPathname = '/my-deck'
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }))

const items = [
  { label: '계정 설정', href: '/settings/account' },
  { label: 'AI 설정', href: '/settings/ai' },
]
const ui = () => <SidebarSection label="설정" icon={Settings} items={items} />

it('비활성 경로에서 마운트한 뒤 그룹 경로로 이동하면 펼쳐진다', () => {
  mockPathname = '/my-deck'
  const view = render(ui())
  expect(screen.queryByRole('link', { name: '계정 설정' })).not.toBeInTheDocument()
  mockPathname = '/settings/account'
  view.rerender(ui())
  expect(screen.getByRole('link', { name: '계정 설정' })).toBeInTheDocument()
})

it('같은 그룹 안에서 이동해도 사용자가 접은 상태를 유지한다', () => {
  mockPathname = '/settings/account'
  const view = render(ui())
  fireEvent.click(screen.getByRole('button', { name: '설정' }))
  expect(screen.queryByRole('link', { name: 'AI 설정' })).not.toBeInTheDocument()
  mockPathname = '/settings/ai'
  view.rerender(ui())
  expect(screen.queryByRole('link', { name: 'AI 설정' })).not.toBeInTheDocument()
})
