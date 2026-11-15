import { render, screen } from '@testing-library/react'
import RecruitingSettingsLayout from '../layout'
import SettingsIndexPage from '../page'

let mockPathname = '/d/recruiting/settings/stores'
const mockRedirect = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  redirect: (url: string) => mockRedirect(url),
}))

it('설정 레이아웃은 제목과 매장/직무 탭 링크를 보이고 현재 탭에 aria-current 를 둔다', () => {
  mockPathname = '/d/recruiting/settings/positions'
  render(
    <RecruitingSettingsLayout>
      <p>본문</p>
    </RecruitingSettingsLayout>
  )
  expect(screen.getByRole('heading', { name: '설정' })).toBeInTheDocument()
  expect(screen.getByText('본문')).toBeInTheDocument()
  const stores = screen.getByRole('link', { name: '매장 관리' })
  const positions = screen.getByRole('link', { name: '직무 관리' })
  expect(stores).toHaveAttribute('href', '/d/recruiting/settings/stores')
  expect(positions).toHaveAttribute('href', '/d/recruiting/settings/positions')
  expect(screen.getByRole('link', { name: '메시지 관리' })).toHaveAttribute(
    'href',
    '/d/recruiting/settings/messages'
  )
  expect(positions).toHaveAttribute('aria-current', 'page')
  expect(stores).not.toHaveAttribute('aria-current')
})

it('/d/recruiting/settings 는 매장 관리로 redirect 한다', () => {
  SettingsIndexPage()
  expect(mockRedirect).toHaveBeenCalledWith('/d/recruiting/settings/stores')
})
