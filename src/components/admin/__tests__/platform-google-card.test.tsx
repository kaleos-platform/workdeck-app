import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlatformGoogleCard } from '../platform-google-card'
import { googleAuthorizeUrl } from '@/lib/agent/integrations/google-marketing'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: Parameters<typeof fetch>) => fetch(...a),
  redirectIfMfaRequired: jest.fn().mockResolvedValue(false),
}))
jest.mock('@/lib/agent/integrations/google-marketing', () => ({
  ...jest.requireActual('@/lib/agent/integrations/google-marketing'),
}))

const empty = {
  registered: false,
  clientId: '',
  hasRefreshToken: false,
  propertyId: '',
  streamId: '',
  status: null,
  connectedAt: null,
  lastError: null,
  ga4: null,
}
const connected = {
  ...empty,
  registered: true,
  clientId: 'cid',
  hasRefreshToken: true,
  propertyId: '412345678',
  streamId: '9876543210',
  status: 'connected' as const,
  ga4: {
    measurementId: 'G-5F8G9Y4VHW',
    enhanced: { streamEnabled: true, scrollsEnabled: false, siteSearchEnabled: null },
    funnel: {
      days: 7,
      events: {
        page_view: 1200,
        cta_click: 3,
        generate_lead: 0,
        sign_up: 2,
        trial_start: 1,
        subscribe: 0,
      },
      sources: [{ source: 'google', medium: 'cpc', signUp: 2, subscribe: 0 }],
    },
    errors: [],
  },
}

test('placeholder·G- 안내·리디렉션 URI 표시', () => {
  render(<PlatformGoogleCard view={empty as never} result={null} />)
  expect(screen.getByPlaceholderText('예: 412345678')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('예: 9876543210')).toBeInTheDocument()
  expect(screen.getByPlaceholderText('예: GOCSPX-…')).toBeInTheDocument()
  expect(screen.getByText(/측정 ID\(G-\)가 아닙니다/)).toBeInTheDocument()
  expect(screen.getByText(/\/api\/admin\/platform\/google\/callback/)).toBeInTheDocument()
  // 저장 전에는 연결 버튼이 비활성
  expect(screen.getByRole('button', { name: 'Google로 연결' })).toBeDisabled()
})

test('시크릿 보기 토글', () => {
  render(<PlatformGoogleCard view={empty as never} result={null} />)
  const input = screen.getByPlaceholderText('예: GOCSPX-…')
  expect(input).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByLabelText('시크릿 보기'))
  expect(input).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByLabelText('시크릿 숨기기'))
  expect(input).toHaveAttribute('type', 'password')
})

test('연결됨: 측정 ID·향상된 측정 경고 표시·퍼널 표', () => {
  render(<PlatformGoogleCard view={connected as never} result="connected" />)
  expect(screen.getByText('G-5F8G9Y4VHW')).toBeInTheDocument()
  const on = screen.getByText(/향상된 측정 전체: 켜짐/)
  expect(on.className).toMatch(/amber/)
  expect(screen.getByText(/스크롤: 꺼짐/).className).not.toMatch(/amber/)
  expect(screen.getByText(/사이트 검색: 알 수 없음/)).toBeInTheDocument()
  expect(screen.getByText(/모두 꺼져야 측정 ID 등록 가능/)).toBeInTheDocument()
  expect(screen.getByText('1,200')).toBeInTheDocument()
  expect(screen.getByText('Google 연결이 완료되었습니다')).toBeInTheDocument()
})

test('「다시 연결」 은 install 라우트를 POST 로 호출한다(실패 응답이면 오류 토스트)', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ message: '실패' }),
  }) as never
  render(<PlatformGoogleCard view={connected as never} result={null} />)
  fireEvent.click(screen.getByRole('button', { name: '다시 연결' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect((fetch as jest.Mock).mock.calls[0][0]).toBe('/api/admin/platform/google/install')
  expect((fetch as jest.Mock).mock.calls[0][1]).toMatchObject({ method: 'POST' })
})

test('googleAuthorizeUrl: 고객용 기본값은 include_granted_scopes 유지, 옵션으로 생략', () => {
  const base = ['s']
  expect(
    new URL(googleAuthorizeUrl('c', base, 'st', 'https://x/cb')).searchParams.get(
      'include_granted_scopes'
    )
  ).toBe('true')
  expect(
    new URL(
      googleAuthorizeUrl('c', base, 'st', 'https://x/cb', { includeGrantedScopes: false })
    ).searchParams.has('include_granted_scopes')
  ).toBe(false)
})
