import { fireEvent, render, screen } from '@testing-library/react'
import { IntegrationsTabs } from '../integrations-tabs'
import type { AttentionItem } from '@/lib/integrations/attention'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('../slack-connect-card', () => ({ SlackConnectCard: () => <p>slack</p> }))
jest.mock('../coupang-api-card', () => ({ CoupangApiCard: () => <p>coupang</p> }))
jest.mock('../agent-toggle-card', () => ({ AgentToggleCard: () => <p>toggle</p> }))
jest.mock('../agent-tokens-card', () => ({ AgentTokensCard: () => <p>tokens</p> }))
jest.mock('../space-secrets-card', () => ({ SpaceSecretsCard: () => <p>secrets</p> }))
jest.mock('../mcp-guide-card', () => ({ McpGuideCard: () => <p>mcp</p> }))

const tokenItem: AttentionItem = {
  tab: 'agents',
  cardId: 'agent-tokens',
  message: '토큰 만료 — Claude 공용',
}
const activeTab = () => screen.getByRole('tab', { selected: true }).textContent
const order = (ids: string[]) =>
  ids.map((id) =>
    document.getElementById(id)!.compareDocumentPosition(document.getElementById(ids[0])!)
  )

describe('IntegrationsTabs', () => {
  it('확인 필요가 없으면 외부 서비스 탭을 열고 건수와 안내를 숨긴다', () => {
    render(<IntegrationsTabs attention={[]} slackStatus={null} />)
    expect(activeTab()).toBe('외부 서비스')
    expect(screen.queryByText(/확인 필요/)).toBeNull()
  })

  it('건수가 있는 첫 탭을 열고 안내와 문제 카드를 위로 올린다', () => {
    render(<IntegrationsTabs attention={[tokenItem]} slackStatus={null} />)
    expect(activeTab()).toBe('에이전트1')
    expect(screen.getByText('확인 필요 1건')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '해결하기' })).toHaveAttribute('href', '#agent-tokens')
    // agent-tokens가 agent-toggle보다 앞에 온다
    expect(order(['agent-tokens', 'agent-toggle'])[1]).toBe(Node.DOCUMENT_POSITION_PRECEDING)
  })

  it('Slack 연결 후 돌아오면 건수와 상관없이 외부 서비스 탭을 연다', () => {
    render(<IntegrationsTabs attention={[tokenItem]} slackStatus="connected" />)
    expect(activeTab()).toBe('외부 서비스')
  })

  it('링크가 지정한 탭이 건수보다 우선하고, 잘못된 값은 무시한다', () => {
    const { unmount } = render(
      <IntegrationsTabs attention={[tokenItem]} slackStatus={null} tab="secrets" />
    )
    expect(activeTab()).toBe('비밀값')
    unmount()
    render(<IntegrationsTabs attention={[tokenItem]} slackStatus={null} tab="nope" />)
    expect(activeTab()).toBe('에이전트1')
  })

  it('탭을 옮겨도 다른 탭 카드는 마운트된 채 남는다', () => {
    render(<IntegrationsTabs attention={[]} slackStatus={null} />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: '비밀값' }))
    expect(activeTab()).toBe('비밀값')
    expect(screen.getByText('slack')).toBeInTheDocument()
  })
})
