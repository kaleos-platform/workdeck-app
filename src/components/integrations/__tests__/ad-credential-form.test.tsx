import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { AdCredentialForm } from '../ad-credential-form'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'
import { buildAppUrl } from '@/lib/domain'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: (...a: Parameters<typeof fetch>) => fetch(...a),
  redirectIfMfaRequired: jest.fn(async () => false),
}))

const res = (body: unknown, status = 200) => {
  const r = { ok: status < 400, status, json: async () => body, clone: () => r }
  return Promise.resolve(r)
}
const empty = {
  registered: false,
  config: null,
  lastVerifiedAt: null,
  hasError: false,
  pendingActions: 0,
}
const metaLoaded = (over = {}) => ({
  registered: true,
  config: {
    defaultBrand: 'A',
    graphVersion: 'v21.0',
    adAccounts: { A: 'act_111', B: '222' },
    accountCurrencies: { act_111: 'KRW', act_222: 'USD' },
  },
  lastVerifiedAt: '2026-11-01T00:00:00Z',
  hasError: false,
  pendingActions: 0,
  ...over,
})
let fetchMock: jest.Mock
const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
const putBody = () => JSON.parse(puts()[0][1].body)

function setup(provider: 'meta-ads' | 'google-marketing' | 'naver-searchad', get: unknown = empty) {
  fetchMock = jest.fn((_u: string, init?: { method?: string }) =>
    init?.method === 'PUT' ? res({ ok: true }) : res(get)
  )
  global.fetch = fetchMock as unknown as typeof fetch
  return render(<AdCredentialForm provider={provider} spaceId="sp1" onChanged={onChanged} />)
}
const onChanged = jest.fn()
const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  jest.clearAllMocks()
  ;(redirectIfMfaRequired as jest.Mock).mockResolvedValue(false)
})

describe('AdCredentialForm', () => {
  it('provider별 입력 칸을 그린다', async () => {
    setup('naver-searchad')
    expect(await screen.findByText('미등록')).toBeInTheDocument()
    for (const l of [
      '액세스 라이선스',
      '비밀 키',
      '관리 고객 ID',
      '브랜드 이름 1',
      '광고주 고객 ID 1',
    ])
      expect(screen.getByLabelText(l)).toBeInTheDocument()
    expect(screen.getByLabelText('비밀 키')).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText('비밀 키')).toHaveValue('')
  })

  it('Google은 리프레시 토큰 칸 없이 클라이언트 칸·GTM 칸과 등록할 리디렉션 주소를 보인다', async () => {
    setup('google-marketing')
    await screen.findByText('미등록')
    expect(screen.queryByLabelText('리프레시 토큰')).not.toBeInTheDocument()
    expect(screen.getByLabelText('클라이언트 ID')).toBeInTheDocument()
    expect(screen.getByText(buildAppUrl('/api/integrations/google/callback'))).toBeInTheDocument()
    expect(screen.getByText(/「테스트」 상태이면 승인이 7일 뒤 만료/)).toBeInTheDocument()
    // 저장 전에는 연결 버튼이 없다
    expect(
      screen.queryByRole('button', { name: /Google로 연결|다시 연결/ })
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('GA4 속성 ID 1')).toBeInTheDocument()
    expect(screen.getByLabelText('태그 관리자 컨테이너 ID (선택) 1')).toBeInTheDocument()
  })

  it('GET 값을 채우고 상태·통화·그래프 버전을 보인다', async () => {
    setup('meta-ads', metaLoaded({ hasError: true }))
    expect(await screen.findByText('등록됨')).toBeInTheDocument()
    expect(screen.getByLabelText('브랜드 이름 1')).toHaveValue('A')
    expect(screen.getByLabelText('광고 계정 ID 2')).toHaveValue('222')
    expect(screen.getByText(/최근 연결 확인에 실패했습니다/)).toBeInTheDocument()
    expect(screen.getByText(/Graph API 버전 v21.0/)).toBeInTheDocument()
    expect(screen.getByText(/예산 제안은 원화 계정만 가능/)).toBeInTheDocument()
    expect(screen.getByLabelText('액세스 토큰')).toHaveValue('')
    expect(screen.getAllByRole('radio')[0]).toBeChecked()
  })

  it('행 추가·삭제와 기본 브랜드 라디오, 1행이면 자동 기본', async () => {
    setup('naver-searchad')
    await screen.findByText('미등록')
    expect(screen.getByRole('radio')).toBeChecked()
    expect(screen.getByRole('button', { name: '브랜드 1 삭제' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '행 추가' }))
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    fireEvent.click(radios[1])
    expect(screen.getAllByRole('radio')[1]).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '브랜드 2 삭제' }))
    expect(screen.getByRole('radio')).toBeChecked()
  })

  it('빈 비밀값·중복 브랜드 이름은 저장 전에 막는다', async () => {
    setup('meta-ads')
    await screen.findByText('미등록')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByText('액세스 토큰 칸을 채워 주세요')).toBeInTheDocument()
    type('액세스 토큰', 't')
    type('앱 시크릿', 's-0123456789')
    type('브랜드 이름 1', 'A')
    type('광고 계정 ID 1', '1')
    fireEvent.click(screen.getByRole('button', { name: '행 추가' }))
    type('브랜드 이름 2', 'A')
    type('광고 계정 ID 2', 'x')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByText('브랜드 이름이 겹칩니다: A')).toBeInTheDocument()
    expect(screen.getByText(/2번째 광고 계정 ID: 숫자만/)).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
  })

  it('비밀 입력값은 보기 아이콘으로 보였다 숨겼다 한다', async () => {
    setup('google-marketing')
    await screen.findByText('미등록')
    const input = screen.getByLabelText('클라이언트 시크릿')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: '클라이언트 시크릿 보기' }))
    expect(input).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: '클라이언트 시크릿 숨기기' }))
    expect(input).toHaveAttribute('type', 'password')
  })

  it('Google 칸에 입력 예시가 있고, 측정 ID(G-)를 넣으면 속성 ID 안내를 한다', async () => {
    setup('google-marketing')
    await screen.findByText('미등록')
    expect(screen.getByLabelText('GA4 속성 ID 1')).toHaveAttribute('placeholder', '예: 412345678')
    expect(screen.getByLabelText('브랜드 이름 1')).toHaveAttribute('placeholder', '예: 우리 쇼핑몰')
    type('클라이언트 ID', 'cid-0123456789')
    type('클라이언트 시크릿', 'sec-0123456789')
    type('브랜드 이름 1', '홈페이지')
    type('GA4 속성 ID 1', 'G-5F8G9Y4VHW')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(screen.getByText(/측정 ID\(G-…\)가 아니라/)).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
  })

  it('Meta 저장 payload에는 graphVersion이 없고 성공하면 비밀값을 비운다', async () => {
    setup('meta-ads', metaLoaded())
    await screen.findByText('등록됨')
    type('액세스 토큰', 'tok-0123456789')
    type('앱 시크릿', 'sec-0123456789')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(putBody()).toEqual({
      secret: { accessToken: 'tok-0123456789', appSecret: 'sec-0123456789' },
      config: { defaultBrand: 'A', adAccounts: { A: 'act_111', B: '222' } },
    })
    expect(screen.getByLabelText('액세스 토큰')).toHaveValue('')
    expect(onChanged).toHaveBeenCalled()
  })

  it('Google·네이버 payload 모양', async () => {
    const g = setup('google-marketing')
    await screen.findByText('미등록')
    type('클라이언트 ID', 'ci-0123456789')
    type('클라이언트 시크릿', 'cs-0123456789')
    type('브랜드 이름 1', 'A')
    type('GA4 속성 ID 1', '1')
    type('태그 관리자 계정 ID (선택) 1', '2')
    type('태그 관리자 컨테이너 ID (선택) 1', '3')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(putBody()).toEqual({
      secret: {
        clientId: 'ci-0123456789',
        clientSecret: 'cs-0123456789',
      },
      config: {
        defaultBrand: 'A',
        brands: { A: { ga4_property_id: '1', gtm_account_id: '2', gtm_container_id: '3' } },
      },
    })
    g.unmount()
    setup('naver-searchad')
    await screen.findByText('미등록')
    type('액세스 라이선스', 'k-0123456789')
    type('비밀 키', 's-0123456789')
    type('관리 고객 ID', '9')
    type('브랜드 이름 1', 'A')
    type('광고주 고객 ID 1', '5')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(putBody()).toEqual({
      secret: { apiKey: 'k-0123456789', secretKey: 's-0123456789' },
      config: { defaultBrand: 'A', managerCustomerId: '9', customers: { A: '5' } },
    })
  })

  it('구글: GTM 을 비우면 저장되고 payload 에 GTM 키가 없다', async () => {
    setup('google-marketing')
    await screen.findByText('미등록')
    type('클라이언트 ID', 'ci-0123456789')
    type('클라이언트 시크릿', 'cs-0123456789')
    type('브랜드 이름 1', 'A')
    type('GA4 속성 ID 1', '1')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(putBody().config.brands).toEqual({ A: { ga4_property_id: '1' } })
  })

  it('구글: GTM 한쪽만 입력하면 안내 문구를 보이고 저장하지 않는다', async () => {
    setup('google-marketing')
    await screen.findByText('미등록')
    type('클라이언트 ID', 'ci-0123456789')
    type('클라이언트 시크릿', 'cs-0123456789')
    type('브랜드 이름 1', 'A')
    type('GA4 속성 ID 1', '1')
    type('태그 관리자 계정 ID (선택) 1', '2')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(
      await screen.findByText('1번째 GTM 계정 ID와 컨테이너 ID는 함께 입력하거나 함께 비워 주세요')
    ).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
  })

  it('구글: GTM 없는 기존 설정은 빈 칸으로 불러온다', async () => {
    setup('google-marketing', {
      ...empty,
      registered: true,
      config: { defaultBrand: 'A', brands: { A: { ga4_property_id: '1' } } },
    })
    await screen.findByText('등록됨')
    expect(screen.getByLabelText('GA4 속성 ID 1')).toHaveValue('1')
    expect(screen.getByLabelText('태그 관리자 계정 ID (선택) 1')).toHaveValue('')
    expect(screen.getByLabelText('태그 관리자 컨테이너 ID (선택) 1')).toHaveValue('')
  })

  it('매핑을 바꾸고 대기 제안이 있으면 확인 뒤에만 저장한다', async () => {
    setup('meta-ads', metaLoaded({ pendingActions: 2 }))
    await screen.findByText('등록됨')
    type('액세스 토큰', 'tok-0123456789')
    type('앱 시크릿', 'sec-0123456789')
    type('광고 계정 ID 2', '333')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(
      await screen.findByText('승인 대기 중인 제안 2건은 바뀐 계정과 맞지 않아 실행되지 않습니다.')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'AI 요청 승인 보기' })).toHaveAttribute(
      'href',
      '/approvals'
    )
    expect(puts()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '그래도 저장' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
  })

  it('매핑이 그대로면 대기 제안이 있어도 바로 저장한다', async () => {
    setup('meta-ads', metaLoaded({ pendingActions: 2 }))
    await screen.findByText('등록됨')
    type('액세스 토큰', 'tok-0123456789')
    type('앱 시크릿', 'sec-0123456789')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(puts()).toHaveLength(1))
  })

  it('서버 400 메시지를 폼에 보인다', async () => {
    setup('naver-searchad')
    await screen.findByText('미등록')
    fetchMock.mockImplementation((_u: string, init?: { method?: string }) =>
      init?.method === 'PUT' ? res({ message: '키가 올바르지 않습니다' }, 400) : res(empty)
    )
    type('액세스 라이선스', 'k-0123456789')
    type('비밀 키', 's-0123456789')
    type('관리 고객 ID', '9')
    type('브랜드 이름 1', 'A')
    type('광고주 고객 ID 1', '5')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('키가 올바르지 않습니다')).toHaveClass('text-destructive')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('MFA 리다이렉트면 성공 처리하지 않는다', async () => {
    ;(redirectIfMfaRequired as jest.Mock).mockResolvedValue(true)
    setup('naver-searchad')
    await screen.findByText('미등록')
    type('액세스 라이선스', 'k-0123456789')
    type('비밀 키', 's-0123456789')
    type('관리 고객 ID', '9')
    type('브랜드 이름 1', 'A')
    type('광고주 고객 ID 1', '5')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(redirectIfMfaRequired).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
  describe('구글 연결', () => {
    const googleLoaded = (
      over: Record<string, unknown> = {},
      cfg: Record<string, unknown> = {}
    ) => ({
      ...empty,
      registered: true,
      config: { defaultBrand: 'A', brands: { A: { ga4_property_id: '1' } }, ...cfg },
      hasRefreshToken: false,
      ...over,
    })
    const assign = jest.fn()
    beforeEach(() => assign.mockClear())

    it('승인 전(토큰 없음): 「승인 필요」 + 「Google로 연결」 → install POST 후 받은 주소로 이동', async () => {
      fetchMock = jest.fn((u: string, init?: { method?: string }) =>
        u.includes('/google/install') && init?.method === 'POST'
          ? res({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' })
          : res(googleLoaded({}, { status: 'needs_auth' }))
      )
      global.fetch = fetchMock as unknown as typeof fetch
      render(<AdCredentialForm provider="google-marketing" spaceId="sp1" navigate={assign} />)
      expect(await screen.findByText('승인 필요')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Google로 연결' }))
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1')
      )
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/google/install'))!
      expect(call[1].method).toBe('POST')
      expect((call[1].body as FormData).get('spaceId')).toBe('sp1')
    })

    it('연결됨: 연결일·권한 표시, 버튼은 「다시 연결」', async () => {
      setup(
        'google-marketing',
        googleLoaded(
          { hasRefreshToken: true },
          {
            status: 'connected',
            connectedAt: '2026-11-21T00:00:00Z',
            scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
          }
        )
      )
      expect(await screen.findByText('연결됨')).toBeInTheDocument()
      expect(screen.getByText(/승인된 권한: analytics.readonly/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '다시 연결' })).toBeInTheDocument()
    })

    it('status 없는 기존 행(수동 토큰)은 연결됨으로 보인다', async () => {
      setup('google-marketing', googleLoaded({ hasRefreshToken: true }))
      expect(await screen.findByText('연결됨')).toBeInTheDocument()
    })

    it('install 실패 메시지를 보이고 이동하지 않는다', async () => {
      fetchMock = jest.fn((u: string, init?: { method?: string }) =>
        init?.method === 'POST' ? res({ message: '먼저 저장해 주세요' }, 400) : res(googleLoaded())
      )
      global.fetch = fetchMock as unknown as typeof fetch
      render(<AdCredentialForm provider="google-marketing" spaceId="sp1" navigate={assign} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Google로 연결' }))
      expect(await screen.findByText('먼저 저장해 주세요')).toBeInTheDocument()
      expect(assign).not.toHaveBeenCalled()
    })

    it.each([
      ['connected', /Google 연결이 완료되었습니다/],
      ['denied', /Google 승인을 취소했습니다/],
      ['scope_missing', /필요한 권한이 모두 승인되지 않았습니다/],
      ['property_denied', /GA4 속성에 접근하지 못했습니다/],
      ['expired', /승인 요청이 만료되었거나/],
    ])('콜백 결과 %s 문구', async (result, text) => {
      fetchMock = jest.fn(() => res(googleLoaded()))
      global.fetch = fetchMock as unknown as typeof fetch
      render(<AdCredentialForm provider="google-marketing" spaceId="sp1" googleResult={result} />)
      expect(await screen.findByText(text)).toBeInTheDocument()
    })
  })
})
