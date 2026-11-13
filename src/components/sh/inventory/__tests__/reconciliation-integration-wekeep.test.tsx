import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReconciliationIntegrationButton } from '../reconciliation-upload'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))

describe('데이터 연동 — 위킵 위치', () => {
  it('위킵 연동 위치를 나열하고 선택하면 source=wekeep 으로 POST', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('coupang-preflight'))
        return { ok: true, json: async () => ({ coupangActive: false }) }
      if (url.includes('/locations'))
        return {
          ok: true,
          json: async () => ({
            locations: [
              { id: 'l1', name: '위킵 안성', isActive: true, syncProvider: 'wekeep' },
              { id: 'l2', name: '일반', isActive: true, syncProvider: null },
              { id: 'l3', name: '꺼짐', isActive: false, syncProvider: 'wekeep' },
            ],
          }),
        }
      expect(init?.method).toBe('POST')
      return { ok: true, json: async () => ({ id: 'r1', totalItems: 1, matchedItems: 1 }) }
    })
    global.fetch = fetchMock as unknown as typeof fetch
    const onUploaded = jest.fn()
    render(<ReconciliationIntegrationButton onUploaded={onUploaded} />)
    fireEvent.click(screen.getByText('데이터 연동'))
    const btn = await screen.findByText('위킵 — 위킵 안성')
    expect(screen.queryByText(/일반/)).toBeNull()
    expect(screen.queryByText(/꺼짐/)).toBeNull()
    fireEvent.click(btn)
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('r1'))
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toEqual({ source: 'wekeep', locationId: 'l1' })
  })
})
