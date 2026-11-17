import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createClient } from '@/lib/supabase/client'
import { OAuthGrantsCard } from '../oauth-grants-card'

jest.mock('@/lib/supabase/client', () => ({ createClient: jest.fn() }))

const GRANT = {
  client: { id: 'cid-1', name: 'ChatGPT', uri: '', logo_uri: '' },
  scopes: ['openid'],
  granted_at: '2026-11-17T00:00:00Z',
}

function mockOauth(lists: object[][]) {
  const listGrants = jest.fn()
  for (const l of lists) listGrants.mockResolvedValueOnce({ data: l, error: null })
  const revokeGrant = jest.fn().mockResolvedValue({ data: {}, error: null })
  ;(createClient as jest.Mock).mockReturnValue({ auth: { oauth: { listGrants, revokeGrant } } })
  return { listGrants, revokeGrant }
}

test('연결된 앱이 없으면 빈 안내', async () => {
  mockOauth([[]])
  render(<OAuthGrantsCard />)
  expect(await screen.findByText('연결된 AI 앱이 없습니다.')).toBeTruthy()
})

test('연결 해제를 확인하면 그 client_id로 철회하고 목록을 다시 불러온다', async () => {
  const { listGrants, revokeGrant } = mockOauth([[GRANT], []])
  render(<OAuthGrantsCard />)
  expect(await screen.findByText('ChatGPT')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '연결 해제' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === '연결 해제')!
  )
  await waitFor(() => expect(revokeGrant).toHaveBeenCalledWith({ clientId: 'cid-1' }))
  expect(await screen.findByText('연결된 AI 앱이 없습니다.')).toBeTruthy()
  expect(listGrants).toHaveBeenCalledTimes(2)
})

test('목록을 못 불러오면 오류 문구', async () => {
  ;(createClient as jest.Mock).mockReturnValue({
    auth: {
      oauth: { listGrants: jest.fn().mockResolvedValue({ data: null, error: new Error('x') }) },
    },
  })
  render(<OAuthGrantsCard />)
  expect(await screen.findByText('연결된 AI 앱을 불러오지 못했습니다.')).toBeTruthy()
})
