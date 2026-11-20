import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchWithMfa } from '@/lib/auth/mfa-client'
import { AiSettingsForm } from '../ai-settings-form'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/auth/mfa-client', () => ({
  fetchWithMfa: jest.fn(),
  redirectIfMfaRequired: jest.fn().mockResolvedValue(false),
}))

const base = {
  mode: 'BYOK',
  provider: 'OPENAI',
  model: null,
  hasKey: true,
  lastVerifiedAt: null,
  lastError: null,
  workdeckAvailable: true,
  usage: { yearMonth: '2026-11', textTokensUsed: 250, textTokenQuota: 1000 },
}

function mockSettings(over: object) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ...base, ...over }),
  }) as unknown as typeof fetch
}

test('무료 사용량 퍼센트를 보여 준다', async () => {
  mockSettings({ mode: 'WORKDECK' })
  render(<AiSettingsForm />)
  expect(await screen.findByText(/이번 달 무료 사용량 25% 사용/)).toBeTruthy()
})

test('공급자를 라벨로 고르면 키 안내 링크가 바뀐다', async () => {
  mockSettings({})
  render(<AiSettingsForm />)
  const link = await screen.findByRole('link', { name: /OpenAI 키 발급/ })
  expect(link).toHaveAttribute('href', 'https://platform.openai.com/api-keys')
  fireEvent.click(screen.getByLabelText('Anthropic'))
  expect(screen.getByRole('link', { name: /Anthropic 키 발급/ })).toHaveAttribute(
    'href',
    'https://console.anthropic.com/settings/keys'
  )
})

test('저장된 사용자 지정 모델은 보이고 직접 입력이 펼쳐져 있으며 그대로 저장된다', async () => {
  mockSettings({ model: 'gpt-5-custom' })
  ;(fetchWithMfa as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) })
  render(<AiSettingsForm />)
  expect(await screen.findByText(/사용 중인 모델: gpt-5-custom/)).toBeTruthy()
  expect(screen.getByText('직접 입력').closest('details')).toHaveAttribute('open')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(fetchWithMfa).toHaveBeenCalled())
  const body = JSON.parse((fetchWithMfa as jest.Mock).mock.calls[0][1].body)
  expect(body.model).toBe('gpt-5-custom')
})

test('추천 모델이면 직접 입력이 접혀 있다', async () => {
  mockSettings({ model: 'gpt-4.1-mini' })
  render(<AiSettingsForm />)
  expect(await screen.findByText('추천 모델 사용(gpt-4.1-mini)')).toBeTruthy()
  expect(screen.getByText('직접 입력').closest('details')).not.toHaveAttribute('open')
})

test('추천 모델 상태에서 공급자를 바꾸면 새 공급자의 추천 모델이 된다', async () => {
  mockSettings({ model: 'gpt-4.1-mini' })
  render(<AiSettingsForm />)
  await screen.findByText('추천 모델 사용(gpt-4.1-mini)')
  fireEvent.click(screen.getByLabelText('Anthropic'))
  expect(screen.getByText(/추천 모델 사용\(claude-/)).toBeTruthy()
  expect(screen.queryByText(/사용 중인 모델/)).toBeNull()
})

test('직접 입력한 값은 저장 전에도 사용 중인 모델로 보인다', async () => {
  mockSettings({ model: 'gpt-4.1-mini' })
  render(<AiSettingsForm />)
  await screen.findByText('추천 모델 사용(gpt-4.1-mini)')
  fireEvent.change(screen.getByLabelText('모델 이름'), { target: { value: 'gpt-5' } })
  expect(screen.getByText('사용 중인 모델: gpt-5(직접 입력)')).toBeTruthy()
})
