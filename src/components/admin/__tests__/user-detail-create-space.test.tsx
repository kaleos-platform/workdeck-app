import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchWithMfa } from '@/lib/auth/mfa-client'
import { UserDetail } from '../user-detail'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))
jest.mock('@/lib/auth/mfa-client', () => ({ fetchWithMfa: jest.fn() }))

const json = (status: number, body: unknown) =>
  ({ status, ok: status < 400, json: async () => body }) as Response

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue(
    json(200, {
      user: {
        id: 'u1',
        email: 'a@b.co',
        name: null,
        avatarUrl: null,
        createdAt: '2026-01-01T00:00:00Z',
        isOperator: false,
        spaceMemberships: [],
      },
      auth: { bannedUntil: null, lastSignInAt: null },
    })
  ) as jest.Mock
  window.confirm = jest.fn(() => true)
})

async function submit(name: string) {
  render(<UserDetail userId="u1" />)
  fireEvent.change(await screen.findByLabelText('새 Space 이름'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: '새 Space 만들기' }))
}

test('이름이 비어 있으면 버튼이 비활성이고 모집 관리 켜기는 기본 체크', async () => {
  render(<UserDetail userId="u1" />)
  expect(await screen.findByRole('button', { name: '새 Space 만들기' })).toBeDisabled()
  expect(screen.getByRole('checkbox')).toBeChecked()
})

test('201 이면 confirm 뒤 POST 하고 Space ID·차단 안내를 보여 준다', async () => {
  ;(fetchWithMfa as jest.Mock).mockResolvedValue(
    json(201, { space: { id: 'sp-new', name: '대성' }, blockedJobs: 2 })
  )
  await submit(' 대성 ')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sp-new'))
  expect(screen.getByRole('status')).toHaveTextContent('2건')
  expect(window.confirm).toHaveBeenCalled()
  expect(fetchWithMfa).toHaveBeenCalledWith(
    '/api/admin/users/u1/spaces',
    expect.objectContaining({ body: JSON.stringify({ name: '대성', enableRecruiting: true }) })
  )
  expect(refresh).toHaveBeenCalled()
})

test('409 면 기존 Space ID 를 보여 준다', async () => {
  ;(fetchWithMfa as jest.Mock).mockResolvedValue(json(409, { message: 'dup', spaceId: 'sp-old' }))
  await submit('대성')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sp-old'))
  expect(screen.getByRole('status')).toHaveTextContent('이미 있습니다')
})

test('confirm 을 취소하면 요청하지 않는다', async () => {
  window.confirm = jest.fn(() => false)
  await submit('대성')
  expect(fetchWithMfa).not.toHaveBeenCalled()
})

test('요청이 throw 하면 alert 로 알리고 버튼이 다시 활성화된다', async () => {
  window.alert = jest.fn()
  ;(fetchWithMfa as jest.Mock).mockRejectedValue(new Error('network'))
  await submit('대성')
  await waitFor(() => expect(window.alert).toHaveBeenCalled())
  expect(screen.getByRole('button', { name: '새 Space 만들기' })).toBeEnabled()
})
