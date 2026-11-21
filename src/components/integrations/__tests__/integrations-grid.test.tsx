import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntegrationsGrid } from '../integrations-grid'
import type { Role } from '@/lib/auth/roles'
import type { IntegrationStatuses } from '@/lib/integrations/load-status'

const replace = jest.fn()
const refresh = jest.fn()
let query = ''
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/settings/integrations',
  useSearchParams: () => new URLSearchParams(query),
}))
jest.mock('../slack-connect-card', () => ({
  SlackConnectCard: ({ slackStatus }: { slackStatus: string | null }) => {
    const [text, setText] = useState('')
    return (
      <input
        aria-label="slack-input"
        data-status={slackStatus ?? ''}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    )
  },
}))
jest.mock('../ad-credential-form', () => ({
  AdCredentialForm: ({ provider }: { provider: string }) => <p>{provider}-body</p>,
}))
jest.mock('../coupang-api-card', () => ({ CoupangApiCard: () => <p>coupang-body</p> }))
jest.mock('../cafe24-connect-card', () => ({ Cafe24ConnectCard: () => <p>cafe24-body</p> }))
jest.mock('../agent-toggle-card', () => ({ AgentToggleCard: () => <p>toggle-body</p> }))
jest.mock('../agent-tokens-card', () => ({ AgentTokensCard: () => <p>tokens-body</p> }))
jest.mock('../space-secrets-card', () => ({ SpaceSecretsCard: () => <p>secrets-body</p> }))
jest.mock('../mcp-guide-card', () => ({ McpGuideCard: () => <p>mcp-body</p> }))
jest.mock('@/components/sc/settings/osmu-connections', () => ({
  OsmuConnections: ({ only }: { only: string }) => <p>{only}-body</p>,
}))

const DECKS = ['coupang-ads', 'seller-hub', 'sales-content']
const statuses: IntegrationStatuses = {
  slack: { state: 'connected', summary: '크림드' },
  'meta-ads': { state: 'connected' },
  'naver-searchad': { state: 'not_connected' },
  secrets: { state: 'attention', summary: '확인 필요' },
}
const attention = [{ id: 'secrets' as const, message: '비밀값 만료 — github-read' }]

const setup = (
  over: Partial<{
    role: Role
    activeDeckIds: string[]
    initialOpen: 'slack' | null
    attention: typeof attention
  }> = {}
) =>
  render(
    <IntegrationsGrid
      role="ADMIN"
      activeDeckIds={DECKS}
      statuses={statuses}
      attention={attention}
      slackStatus={null}
      initialOpen={null}
      spaceId="sp1"
      {...over}
    />
  )

describe('IntegrationsGrid', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    query = ''
  })

  it('그룹과 타일, 요약, 확인 필요 목록을 보여 준다', () => {
    setup()
    for (const g of ['판매 채널', '광고·마케팅', '협업 도구', 'AI·에이전트', '기타'])
      expect(screen.getByRole('heading', { name: g })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('연결됨 2 · 연결 필요 1 · 확인 필요 1')
    expect(screen.getByText('비밀값 만료 — github-read')).toBeInTheDocument()
  })

  it('꺼진 업무 전용 타일은 숨긴다', () => {
    setup({ activeDeckIds: [] })
    expect(screen.queryByRole('heading', { name: '노션' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '쿠팡 로그인' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Slack' })).toBeInTheDocument()
  })

  it('광고 3종 타일은 ADMIN이 팝업으로 연다', () => {
    for (const id of ['meta-ads', 'google-marketing', 'naver-searchad']) {
      query = `open=${id}`
      const { unmount } = setup()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(`${id}-body`)).toBeInTheDocument()
      unmount()
    }
    query = ''
    setup()
    expect(screen.queryByRole('button', { name: '준비 중' })).toBeNull()
  })

  it('타일 버튼은 open만 바꾸고 다른 query를 보존한다', () => {
    query = 'foo=1'
    setup()
    fireEvent.click(screen.getAllByRole('button', { name: '관리' })[0]) // 목록 순서상 첫 연결됨 타일(meta-ads)
    expect(replace).toHaveBeenCalledWith('/settings/integrations?foo=1&open=meta-ads', {
      scroll: false,
    })
  })

  it('[확인]은 해당 팝업을 연다', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(replace).toHaveBeenCalledWith('/settings/integrations?open=secrets', { scroll: false })
  })

  it('?open= 이 있으면 팝업이 열려 있고, 잘못된 값은 무시한다', () => {
    query = 'open=coupang-api'
    const { unmount } = setup()
    expect(screen.getByRole('dialog', { name: '쿠팡 Open API' })).toBeInTheDocument()
    expect(screen.getByText('coupang-body')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '쿠팡 Wing 열기' })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    )
    unmount()
    query = 'open=nope'
    setup()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('옛 ?slack= 은 한 번 소비해 ?foo=1&open=slack 으로 바꾼다', () => {
    query = 'slack=success&foo=1'
    setup({ initialOpen: 'slack' })
    expect(replace).toHaveBeenCalledWith('/settings/integrations?foo=1&open=slack', {
      scroll: false,
    })
    expect(screen.getByRole('dialog', { name: 'Slack' })).toBeInTheDocument()
  })

  it('옛 query를 소비한 뒤 서버가 slackStatus를 null로 내려도 처음 결과를 유지하고, 닫은 뒤 다시 렌더해도 열리지 않는다', () => {
    query = 'slack=team_changed&foo=1'
    const { rerender } = render(
      <IntegrationsGrid
        role="ADMIN"
        activeDeckIds={DECKS}
        statuses={statuses}
        attention={attention}
        slackStatus="team_changed"
        initialOpen="slack"
      />
    )
    expect(screen.getByLabelText('slack-input')).toHaveAttribute('data-status', 'team_changed')
    query = 'foo=1&open=slack'
    rerender(
      <IntegrationsGrid
        role="ADMIN"
        activeDeckIds={DECKS}
        statuses={statuses}
        attention={attention}
        slackStatus={null}
        initialOpen={null}
      />
    )
    expect(screen.getByLabelText('slack-input')).toHaveAttribute('data-status', 'team_changed')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(replace).toHaveBeenLastCalledWith('/settings/integrations?foo=1', { scroll: false })
    query = 'foo=1'
    rerender(
      <IntegrationsGrid
        role="ADMIN"
        activeDeckIds={DECKS}
        statuses={statuses}
        attention={attention}
        slackStatus={null}
        initialOpen={null}
      />
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('팝업 본문 안을 눌러도 팝업이 닫히지 않는다', () => {
    query = 'open=slack'
    setup()
    fireEvent.pointerDown(screen.getByLabelText('slack-input'))
    fireEvent.mouseDown(screen.getByLabelText('slack-input'))
    expect(replace).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Slack' })).toBeInTheDocument()
  })

  it('닫으면 open만 지우고 refresh한다', () => {
    query = 'open=slack&foo=1'
    setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(replace).toHaveBeenCalledWith('/settings/integrations?foo=1', { scroll: false })
    expect(refresh).toHaveBeenCalled()
  })

  it('팝업을 닫았다 다시 열어도 본문 state가 남는다', () => {
    query = 'open=slack'
    const { rerender } = setup()
    fireEvent.change(screen.getByLabelText('slack-input'), { target: { value: '입력 중' } })
    query = ''
    rerender(
      <IntegrationsGrid
        role="ADMIN"
        activeDeckIds={DECKS}
        statuses={statuses}
        attention={attention}
        slackStatus={null}
        initialOpen={null}
      />
    )
    query = 'open=slack'
    rerender(
      <IntegrationsGrid
        role="ADMIN"
        activeDeckIds={DECKS}
        statuses={statuses}
        attention={attention}
        slackStatus={null}
        initialOpen={null}
      />
    )
    expect(screen.getByLabelText('slack-input')).toHaveValue('입력 중')
  })

  it('MEMBER는 my-ai-app만 열 수 있고 토큰·비밀값 타일이 없다', () => {
    setup({ role: 'MEMBER', attention: [] })
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['연결 방법'])
    expect(screen.queryByRole('heading', { name: '에이전트 접속 토큰' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '직접 등록한 API·로그인' })).toBeNull()
    expect(screen.getAllByText('관리자에게 요청').length).toBeGreaterThan(0)
    expect(screen.queryByText(/확인 필요/)).toBeNull()
  })

  it('MEMBER는 관리자 전용 팝업을 ?open= 으로 열 수 없다', () => {
    query = 'open=secrets'
    setup({ role: 'MEMBER', attention: [] })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('secrets-body')).toBeNull()
    query = 'open=meta-ads'
    setup({ role: 'MEMBER', attention: [] })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('meta-ads-body')).toBeNull()
  })
})
