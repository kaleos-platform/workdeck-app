import { render, screen } from '@testing-library/react'
import IntegrationsSettingsPage from '../page'
import { loadShellContext } from '@/lib/workspace-shell'
import { loadIntegrationStatuses } from '@/lib/integrations/load-status'

jest.mock('@/hooks/use-user', () => ({ getUser: jest.fn(async () => ({ id: 'u1' })) }))
jest.mock('@/lib/workspace-shell', () => ({ loadShellContext: jest.fn() }))
jest.mock('@/lib/integrations/load-status', () => ({
  loadIntegrationStatuses: jest.fn(async () => ({ statuses: {}, attention: [] })),
}))
const grid = jest.fn((props: Record<string, unknown>) => <p>grid {String(props.role)}</p>)
jest.mock('@/components/integrations/integrations-grid', () => ({
  IntegrationsGrid: (props: Record<string, unknown>) => grid(props),
}))

const renderPage = async (searchParams: { slack?: string; tab?: string } = {}) =>
  render(await IntegrationsSettingsPage({ searchParams: Promise.resolve(searchParams) }))

describe('IntegrationsSettingsPage', () => {
  beforeEach(() => jest.clearAllMocks())

  it('역할과 활성 업무로 상태를 읽어 그리드에 넘긴다', async () => {
    ;(loadShellContext as jest.Mock).mockResolvedValue({
      role: 'MEMBER',
      spaceId: 's1',
      activeDecks: [{ id: 'seller-hub' }],
    })
    await renderPage()
    expect(loadIntegrationStatuses).toHaveBeenCalledWith('s1', 'u1', 'MEMBER')
    expect(screen.getByText('grid MEMBER')).toBeInTheDocument()
    expect(grid.mock.lastCall?.[0]).toMatchObject({
      activeDeckIds: ['seller-hub'],
      initialOpen: null,
    })
  })

  it.each([
    [{ tab: 'agents' }, 'agent-tokens'],
    [{ tab: 'secrets' }, 'secrets'],
    [{ tab: 'services' }, null],
    [{ tab: 'nope' }, null],
    [{ slack: 'success', tab: 'agents' }, 'slack'],
  ])('옛 링크 %j를 초기 팝업 %s로 바꾼다', async (params, expected) => {
    ;(loadShellContext as jest.Mock).mockResolvedValue({
      role: 'ADMIN',
      spaceId: 's1',
      activeDecks: [],
    })
    await renderPage(params)
    expect(grid.mock.lastCall?.[0].initialOpen).toBe(expected)
  })
})
