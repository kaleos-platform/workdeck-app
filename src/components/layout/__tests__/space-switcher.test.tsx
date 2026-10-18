import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpaceSwitcher } from '../space-switcher'

const assign = jest.fn()
beforeEach(() => {
  jest.resetAllMocks()
})

const two = [
  { id: 'sp-a', name: 'Space A', role: 'OWNER' },
  { id: 'sp-b', name: 'Space B', role: 'MEMBER' },
]
const respond = (spaces: typeof two, postStatus = 204) => {
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    const status = init?.method === 'POST' ? postStatus : 200
    return { ok: status < 400, status, json: async () => ({ current: spaces[0], spaces }) }
  }) as unknown as typeof fetch
}

it('Space 가 하나면 이름만(전환 메뉴 없음)', async () => {
  respond([two[0]])
  render(<SpaceSwitcher fallbackName="Space A" navigate={assign} />)
  expect(await screen.findByText('Space A')).toBeInTheDocument()
  expect(screen.queryByRole('combobox')).toBeNull()
})

it('여러 개면 고르고 → POST 후 /my-deck 로 새로고침', async () => {
  respond(two)
  render(<SpaceSwitcher fallbackName="Space A" navigate={assign} />)
  await userEvent.selectOptions(await screen.findByRole('combobox'), 'sp-b')
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/my-deck'))
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/spaces/current',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ spaceId: 'sp-b' }) })
  )
})

it('POST 실패면 이동하지 않고 select 를 다시 활성화', async () => {
  respond(two, 404)
  render(<SpaceSwitcher fallbackName="Space A" navigate={assign} />)
  const select = await screen.findByRole('combobox')
  await userEvent.selectOptions(select, 'sp-b')
  await waitFor(() => expect(select).toBeEnabled())
  expect(assign).not.toHaveBeenCalled()
})
