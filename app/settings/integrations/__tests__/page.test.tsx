import { render, screen } from '@testing-library/react'
import IntegrationsSettingsPage from '../page'
import { loadShellContext } from '@/lib/workspace-shell'
import { loadIntegrationAttention } from '@/lib/integrations/load-attention'

jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn(async () => ({ id: 'u1' })) }))
jest.mock('@/lib/workspace-shell', () => ({ loadShellContext: jest.fn() }))
jest.mock('@/lib/integrations/load-attention', () => ({
  loadIntegrationAttention: jest.fn(async () => []),
}))
jest.mock('@/components/integrations/integrations-tabs', () => ({
  IntegrationsTabs: () => <p>tabs</p>,
}))
jest.mock('@/components/integrations/mcp-guide-card', () => ({ McpGuideCard: () => <p>mcp</p> }))

const renderPage = async () =>
  render(await IntegrationsSettingsPage({ searchParams: Promise.resolve({}) }))

describe('IntegrationsSettingsPage', () => {
  beforeEach(() => jest.clearAllMocks())

  it('MEMBER에게는 요약을 조회하지 않고 MCP 가이드만 보여 준다', async () => {
    ;(loadShellContext as jest.Mock).mockResolvedValue({ role: 'MEMBER', spaceId: 's1' })
    await renderPage()
    expect(loadIntegrationAttention).not.toHaveBeenCalled()
    expect(screen.getByText('mcp')).toBeInTheDocument()
    expect(screen.queryByText('tabs')).toBeNull()
  })

  it('ADMIN에게는 요약을 조회해 탭을 보여 준다', async () => {
    ;(loadShellContext as jest.Mock).mockResolvedValue({ role: 'ADMIN', spaceId: 's1' })
    await renderPage()
    expect(loadIntegrationAttention).toHaveBeenCalledWith('s1', 'u1')
    expect(screen.getByText('tabs')).toBeInTheDocument()
  })
})
