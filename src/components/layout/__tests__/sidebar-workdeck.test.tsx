import { render, screen } from '@testing-library/react'
import { Sidebar } from '../sidebar'

let mockPathname = '/my-deck'
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}))
jest.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ signOut: jest.fn() }) }))

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
})

const SETTINGS_LABELS = [
  '외부 서비스 연결',
  '계정 설정',
  'AI 설정',
  '팀원 초대·관리',
  '업무 구독',
  '결제 수단·내역',
]

function visibleSettingsLabels() {
  return SETTINGS_LABELS.filter((name) => screen.queryByRole('link', { name }))
}

it('위쪽에는 홈과 AI 요청 승인만 있고 설정 항목은 접혀 있다', () => {
  render(<Sidebar mobile role="OWNER" isOwner />)
  expect(screen.getByRole('link', { name: '홈' })).toHaveAttribute('href', '/my-deck')
  expect(screen.getByRole('link', { name: 'AI 요청 승인' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '설정' })).toHaveAttribute('aria-expanded', 'false')
  expect(visibleSettingsLabels()).toEqual([])
})

it.each([
  ['MEMBER', false, ['외부 서비스 연결', '계정 설정']],
  ['ADMIN', false, ['외부 서비스 연결', '계정 설정', 'AI 설정', '팀원 초대·관리']],
  ['OWNER', true, SETTINGS_LABELS],
] as const)('%s 역할의 설정 그룹 항목', (role, isOwner, expected) => {
  mockPathname = '/settings/integrations'
  render(<Sidebar mobile role={role} isOwner={isOwner} />)
  expect(screen.getByRole('button', { name: '설정' })).toHaveAttribute('aria-expanded', 'true')
  expect(visibleSettingsLabels()).toEqual(expected)
})
