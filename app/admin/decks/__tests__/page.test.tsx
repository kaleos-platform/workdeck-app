import { render, screen, within } from '@testing-library/react'
import { requireOperator } from '@/lib/admin/auth'
import { redirect } from 'next/navigation'
import Page from '../page'
import Layout from '../../layout'
import Home from '../../page'
import { mfaStepUpPath } from '@/lib/auth/mfa-policy'

jest.mock('@/lib/admin/auth', () => ({ requireOperator: jest.fn() }))
jest.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND')
  },
  redirect: jest.fn(() => {
    throw new Error('REDIRECT')
  }),
}))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/admin/admin-user-menu', () => ({ AdminUserMenu: () => null }))
jest.mock('@/lib/admin/metrics', () => ({ getAdminMetrics: jest.fn().mockResolvedValue({}) }))
jest.mock('@/components/admin/metric-cards', () => ({ MetricCards: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  jest
    .mocked(requireOperator)
    .mockResolvedValue({ ok: true, user: { id: 'operator', email: 'operator@example.test' } })
})

test('새 업무 관리 페이지는 운영자에게 모든 덱을 표시한다', async () => {
  render(await Page())
  expect(requireOperator).toHaveBeenCalled()
  expect(screen.getByRole('heading', { name: '업무 관리', level: 1 })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /샘플 템플릿/ })).toBeInTheDocument()
})

test('운영자가 아니면 새 관리 페이지에 접근할 수 없다', async () => {
  jest
    .mocked(requireOperator)
    .mockResolvedValue({ ok: false, reason: 'NOT_OPERATOR', response: {} } as never)
  await expect(Page()).rejects.toThrow('NOT_FOUND')
})

test('MFA가 필요하면 업무 관리 경로를 유지해 인증으로 이동한다', async () => {
  jest
    .mocked(requireOperator)
    .mockResolvedValue({ ok: false, reason: 'MFA_REQUIRED', response: {} } as never)
  await expect(Page()).rejects.toThrow('REDIRECT')
  expect(redirect).toHaveBeenCalledWith(mfaStepUpPath('/admin/decks'))
})

test('상단 메뉴는 업무 관리 하나로 진입하고 전용 기능은 직접 노출하지 않는다', async () => {
  render(await Layout({ children: <div>검증</div> }))
  const nav = screen.getByRole('navigation')
  expect(within(nav).getByRole('link', { name: '업무 관리' })).toHaveAttribute(
    'href',
    '/admin/decks'
  )
  expect(within(nav).queryByRole('link', { name: '템플릿' })).not.toBeInTheDocument()
  expect(within(nav).queryByRole('link', { name: '첨부 정리 이력' })).not.toBeInTheDocument()
  expect(within(nav).getByRole('link', { name: '구독 현황' })).toHaveAttribute(
    'href',
    '/admin/subscriptions'
  )
  expect(within(nav).getByRole('link', { name: '결제' })).toHaveAttribute('href', '/admin/billing')
})

test('대시보드는 업무 관리 카드로 진입한다', async () => {
  render(await Home())
  expect(screen.getByRole('link', { name: /업무 관리/ })).toHaveAttribute('href', '/admin/decks')
  expect(screen.queryByRole('link', { name: /템플릿/ })).not.toBeInTheDocument()
})
