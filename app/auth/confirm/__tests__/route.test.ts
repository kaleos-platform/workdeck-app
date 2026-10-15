/** @jest-environment node */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GET } from '../route'

const verifyOtp = jest.fn()
beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({ auth: { verifyOtp } })
})

const call = (qs: string) => GET(new NextRequest(`https://app.example/auth/confirm?${qs}`))

test('초대 링크 토큰이 만료돼도 초대 화면으로 보낸다(로그인 후 수락 가능)', async () => {
  verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
  const res = await call('token_hash=h&type=invite&next=%2Finvite%2Ftok123')
  expect(res.headers.get('location')).toBe('https://app.example/invite/tok123')
})

test('초대가 아닌 링크 실패는 기존처럼 로그인 오류 화면', async () => {
  verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })
  const res = await call('token_hash=h&type=recovery&next=%2Fmy-deck')
  expect(res.headers.get('location')).toBe('https://app.example/login?error=auth_callback_error')
})

test('성공하면 next 로 이동', async () => {
  verifyOtp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  const res = await call('token_hash=h&type=invite&next=%2Finvite%2Ftok123')
  expect(res.headers.get('location')).toBe('https://app.example/invite/tok123')
})
