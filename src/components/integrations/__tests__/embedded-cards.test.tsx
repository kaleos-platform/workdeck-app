import { render, screen } from '@testing-library/react'
import { AgentToggleCard } from '../agent-toggle-card'
import { McpGuideCard } from '../mcp-guide-card'

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as never
})

describe('embedded 카드', () => {
  it('AgentToggleCard: 기본은 제목을 보이고 embedded면 숨긴다', async () => {
    const { unmount } = render(<AgentToggleCard />)
    await screen.findByText(/요청 0/)
    expect(screen.getByText('workdeck 에이전트')).toBeInTheDocument()
    unmount()
    render(<AgentToggleCard embedded />)
    await screen.findByText(/요청 0/)
    expect(screen.queryByText('workdeck 에이전트')).toBeNull()
    expect(screen.getByLabelText('에이전트 활성화')).toBeInTheDocument()
  })

  it('McpGuideCard: 기본은 제목을 보이고 embedded면 숨긴다', () => {
    const { unmount } = render(<McpGuideCard />)
    expect(screen.getByText('내 에이전트 연결(MCP)')).toBeInTheDocument()
    unmount()
    render(<McpGuideCard embedded />)
    expect(screen.queryByText('내 에이전트 연결(MCP)')).toBeNull()
    expect(screen.getByText('MCP 서버 URL')).toBeInTheDocument()
  })
})
