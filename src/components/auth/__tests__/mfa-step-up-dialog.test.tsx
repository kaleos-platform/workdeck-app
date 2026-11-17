import { screen, fireEvent, waitFor } from '@testing-library/react'
import { requestMfaStepUp } from '../mfa-step-up-dialog'

const listFactors = jest.fn()
const challengeAndVerify = jest.fn()
const getAuthenticatorAssuranceLevel = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { mfa: { listFactors, challengeAndVerify, getAuthenticatorAssuranceLevel } },
  }),
}))

const totp = { id: 'f1', factor_type: 'totp', status: 'verified' }

beforeEach(() => {
  listFactors.mockReset().mockResolvedValue({ data: { all: [totp] }, error: null })
  challengeAndVerify.mockReset()
  getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
    data: { currentLevel: 'aal1', currentAuthenticationMethods: [] },
    error: null,
  })
})

it('이미 aal2(30일 이내)면 다이얼로그 없이 verified', async () => {
  getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: {
      currentLevel: 'aal2',
      currentAuthenticationMethods: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) }],
    },
    error: null,
  })
  await expect(requestMfaStepUp()).resolves.toBe('verified')
  expect(listFactors).not.toHaveBeenCalled()
  expect(screen.queryByText('2단계 인증')).not.toBeInTheDocument()
})

it('인증 기기 조회 실패는 enroll 이 아니라 unavailable(등록 페이지 이동 방지)', async () => {
  listFactors.mockResolvedValue({ data: null, error: { message: 'down' } })
  await expect(requestMfaStepUp()).resolves.toBe('unavailable')
})

it('verified TOTP 기기가 없으면 렌더 없이 enroll', async () => {
  listFactors.mockResolvedValue({ data: { all: [] }, error: null })
  await expect(requestMfaStepUp()).resolves.toBe('enroll')
  expect(screen.queryByText('2단계 인증')).not.toBeInTheDocument()
})

it('올바른 코드 → verified, 다이얼로그 제거', async () => {
  challengeAndVerify.mockResolvedValue({ data: {}, error: null })
  const p = requestMfaStepUp()
  const input = await screen.findByLabelText('인증 코드')
  fireEvent.change(input, { target: { value: '12a3456' } })
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  await expect(p).resolves.toBe('verified')
  expect(challengeAndVerify).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' })
  await waitFor(() => expect(screen.queryByText('2단계 인증')).not.toBeInTheDocument())
})

it('틀린 코드 → 오류 표시, 다이얼로그 유지', async () => {
  challengeAndVerify.mockResolvedValue({ data: null, error: { message: 'bad' } })
  const p = requestMfaStepUp()
  fireEvent.change(await screen.findByLabelText('인증 코드'), { target: { value: '000000' } })
  fireEvent.click(screen.getByRole('button', { name: '확인' }))
  expect(await screen.findByText('인증 코드가 올바르지 않습니다.')).toBeInTheDocument()
  expect(screen.getByText('2단계 인증')).toBeInTheDocument()
  // 정리: 닫아서 Promise 를 끝낸다.
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  await expect(p).resolves.toBe('cancelled')
  await waitFor(() => expect(screen.queryByText('2단계 인증')).not.toBeInTheDocument())
})

it('닫기 → cancelled', async () => {
  const p = requestMfaStepUp()
  await screen.findByText('2단계 인증')
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  await expect(p).resolves.toBe('cancelled')
  await waitFor(() => expect(screen.queryByText('2단계 인증')).not.toBeInTheDocument())
})
