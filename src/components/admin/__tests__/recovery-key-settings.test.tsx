import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RecoveryKeySettings } from '../recovery-key-settings'
import { redirectIfMfaRequired } from '@/lib/auth/mfa-client'
jest.mock('@/lib/auth/mfa-client', () => ({ redirectIfMfaRequired: jest.fn() }))
const missing = {
  keyId: 'k1',
  stored: false,
  createdAt: null,
  lastVerifiedAt: null,
  sourceAvailable: true,
}
const saved = {
  ...missing,
  stored: true,
  createdAt: '2026-10-27T00:00:00Z',
  lastVerifiedAt: '2026-10-27T01:00:00Z',
}
const response = (body: unknown, ok = true) => ({ ok, json: async () => body })
beforeEach(() => {
  jest.clearAllMocks()
  ;(redirectIfMfaRequired as jest.Mock).mockResolvedValue(false)
  global.fetch = jest.fn().mockResolvedValue(response(missing))
})
test('metadata 조회 완료 전에는 보관 실행을 제공하지 않는다', () => {
  global.fetch = jest.fn().mockReturnValue(new Promise(() => {}))
  render(<RecoveryKeySettings />)
  expect(screen.queryByRole('button', { name: '사본 보관' })).not.toBeInTheDocument()
})
test('최초 보관은 명시 확인 후 action만 보내고 성공 상태를 보여준다', async () => {
  ;(fetch as jest.Mock)
    .mockResolvedValueOnce(response(missing))
    .mockResolvedValueOnce(response(saved))
  render(<RecoveryKeySettings />)
  fireEvent.click(await screen.findByRole('button', { name: '사본 보관' }))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '보관 실행' }))
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith('/api/admin/recovery-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'backup' }),
    })
  )
  expect(await screen.findByText('보관됨')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /보기|내보내기|키 복사/ })).not.toBeInTheDocument()
})
test('기존 사본에는 검증만 제공하고 원본이 없으면 실행을 막는다', async () => {
  global.fetch = jest.fn().mockResolvedValue(response({ ...saved, sourceAvailable: false }))
  render(<RecoveryKeySettings />)
  expect(await screen.findByRole('button', { name: '사본 일치 검증' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: '사본 보관' })).not.toBeInTheDocument()
})
test('검증 충돌 메시지를 보여주며 기존 보관 상태를 성공으로 바꾸지 않는다', async () => {
  ;(fetch as jest.Mock)
    .mockResolvedValueOnce(response(saved))
    .mockResolvedValueOnce(response({ message: '현재 키와 다른 사본입니다' }, false))
  render(<RecoveryKeySettings />)
  fireEvent.click(await screen.findByRole('button', { name: '사본 일치 검증' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('현재 키와 다른 사본입니다')
  expect(screen.getByText('보관됨')).toBeInTheDocument()
})
test('상태 조회 실패는 미보관으로 표시하지 않고 재시도를 제공한다', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network'))
  render(<RecoveryKeySettings />)
  expect(await screen.findByRole('alert')).toHaveTextContent('상태를 불러오지 못했습니다')
  expect(screen.queryByText('미보관')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '상태 새로고침' })).toBeEnabled()
})
