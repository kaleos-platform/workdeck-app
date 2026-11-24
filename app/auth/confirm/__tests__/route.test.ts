/** @jest-environment node */
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }))
jest.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: jest.fn(), update: jest.fn() } },
}))
jest.mock('@/lib/admin/auth', () => ({ writeAuditLog: jest.fn() }))

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { GET, POST } from '../route'

const verifyOtp = jest.fn()
const signOut = jest.fn()
const ORIGIN = 'https://app.example'
beforeEach(() => {
  jest.clearAllMocks()
  ;(createClient as jest.Mock).mockResolvedValue({ auth: { verifyOtp, signOut } })
})

const post = (fields: Record<string, string>, origin: string | null = ORIGIN) =>
  POST(
    new NextRequest(`${ORIGIN}/auth/confirm`, {
      method: 'POST',
      headers: origin ? { origin } : {},
      body: new URLSearchParams({ token_hash: 'h', ...fields }),
    })
  )
const ok = (user: object = { id: 'u1' }) =>
  verifyOtp.mockResolvedValue({ data: { user }, error: null })
const fail = () =>
  verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } })

test('GET 은 토큰을 검증하지 않고 쿼리 그대로 확인 화면으로 보낸다(기존 초대 링크 호환)', async () => {
  const res = await GET(
    new NextRequest(`${ORIGIN}/auth/confirm?token_hash=h&type=invite&next=%2Finvite%2Ftok123`)
  )
  expect(verifyOtp).not.toHaveBeenCalled()
  expect(res.headers.get('location')).toBe(
    `${ORIGIN}/auth/confirm/continue?token_hash=h&type=invite&next=%2Finvite%2Ftok123`
  )
})

test('Origin 이 없거나 다르면 403 이고 검증하지 않는다', async () => {
  expect((await post({ type: 'invite' }, 'https://evil.example')).status).toBe(403)
  expect((await post({ type: 'invite' }, null)).status).toBe(403)
  expect(verifyOtp).not.toHaveBeenCalled()
})

test('허용하지 않는 type 은 검증하지 않는다', async () => {
  const res = await post({ type: 'sms' })
  expect(verifyOtp).not.toHaveBeenCalled()
  expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth_callback_error`)
})

test('invite 성공 — next 로 303', async () => {
  ok()
  const res = await post({ type: 'invite', next: '/invite/tok123' })
  expect(res.status).toBe(303)
  expect(res.headers.get('location')).toBe(`${ORIGIN}/invite/tok123`)
})

test('invite 토큰이 만료돼도 초대 화면으로 보낸다(로그인 후 수락 가능)', async () => {
  fail()
  const res = await post({ type: 'invite', next: '/invite/tok123' })
  expect(res.headers.get('location')).toBe(`${ORIGIN}/invite/tok123`)
})

test('email 성공 — 세션 종료 후 로그인 화면(공간 로그인 변형 포함)', async () => {
  ok()
  expect((await post({ type: 'email' })).headers.get('location')).toBe(
    `${ORIGIN}/login?verified=success`
  )
  expect(signOut).toHaveBeenCalled()
  expect((await post({ type: 'email', next: '/d/abc' })).headers.get('location')).toBe(
    `${ORIGIN}/d/abc/login?verified=success&redirectTo=%2Fd%2Fabc`
  )
})

test('recovery 성공 — 세션 유지하고 /reset-password', async () => {
  ok()
  const res = await post({ type: 'recovery', next: '/my-deck' })
  expect(res.headers.get('location')).toBe(`${ORIGIN}/reset-password`)
  expect(signOut).not.toHaveBeenCalled()
})

test('email_change 성공 — prisma 이메일 동기화 후 이동', async () => {
  ok({ id: 'u1', email: 'new@example.com' })
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ email: 'old@example.com' })
  const res = await post({ type: 'email_change' })
  expect(prisma.user.update).toHaveBeenCalledWith({
    where: { id: 'u1' },
    data: { email: 'new@example.com' },
  })
  expect(res.headers.get('location')).toBe(`${ORIGIN}/admin/account`)
})

test('magiclink 성공 — next 로 이동, 외부 주소 next 는 무시', async () => {
  ok()
  expect((await post({ type: 'magiclink', next: '/approvals' })).headers.get('location')).toBe(
    `${ORIGIN}/approvals`
  )
  expect(
    (await post({ type: 'magiclink', next: 'https://evil.example/x' })).headers.get('location')
  ).toBe(`${ORIGIN}/admin/account`)
})

test('초대가 아닌 링크 실패는 type 별 안내 화면(막다른 길 아님)', async () => {
  fail()
  const res = await post({ type: 'recovery', next: '/my-deck' })
  expect(res.headers.get('location')).toBe(
    `${ORIGIN}/auth/confirm/continue?error=expired&type=recovery`
  )
})
