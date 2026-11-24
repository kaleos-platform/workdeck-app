import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import {
  emailVerifiedLoginPath,
  sanitizeRedirectPath,
  resolveRedirectPath,
} from '@/lib/auth-redirect'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/admin/auth'

const OTP_TYPES: readonly string[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
] satisfies EmailOtpType[]

// GET /auth/confirm?token_hash=...&type=...&next=... — 메일 보안 장비가 링크를 먼저 열어도 일회용 토큰이
// 소비되지 않도록 여기서는 검증하지 않고 확인 화면으로만 보낸다(이미 발송된 초대 메일 링크도 그대로 동작).
export async function GET(request: NextRequest) {
  const { search, origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/auth/confirm/continue${search}`)
}

// POST /auth/confirm — 확인 화면의 버튼(form)이 제출. OTP(token_hash)를 검증하고 type 별로 이동한다.
// 계정 이메일 변경 등 세션 없는 기기/메일 앱에서도 열릴 수 있어, verifyOtp 응답의 user를 직접 사용한다.
export async function POST(request: NextRequest) {
  const { origin } = new URL(request.url)
  // 다른 사이트가 사용자 브라우저로 남의 토큰을 제출해 로그인시키는 것을 막는다.
  if (request.headers.get('origin') !== origin) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const form = await request.formData()
  const tokenHash = form.get('token_hash')
  const type = form.get('type')
  const requestedNext = sanitizeRedirectPath(
    typeof form.get('next') === 'string' ? (form.get('next') as string) : null
  )
  const see = (path: string) => NextResponse.redirect(`${origin}${path}`, 303)

  if (
    typeof tokenHash !== 'string' ||
    !tokenHash ||
    typeof type !== 'string' ||
    !OTP_TYPES.includes(type)
  ) {
    return see('/login?error=auth_callback_error')
  }
  const otpType = type as EmailOtpType

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })

  if (error || !data.user) {
    // 초대 메일 링크(OTP)는 초대(7일)보다 빨리 만료된다 — 초대 화면으로 보내 로그인·가입 후 수락하게 한다.
    if (requestedNext?.startsWith('/invite/')) return see(requestedNext)
    // 그 밖의 만료·사용 완료는 막다른 길이 되지 않게 다음 단계를 안내하는 화면으로.
    return see(`/auth/confirm/continue?error=expired&type=${otpType}`)
  }

  if (otpType === 'recovery') return see('/reset-password')

  if (otpType === 'email' || otpType === 'signup') {
    await supabase.auth.signOut()
    return see(emailVerifiedLoginPath(requestedNext))
  }

  // 이메일 변경 확인 — Supabase user.email과 prisma 값이 다를 때만 동기화(감사 로그는 여기서만 기록)
  if (otpType === 'email_change' && data.user.email) {
    const { id, email } = data.user
    const dbUser = await prisma.user.findUnique({ where: { id }, select: { email: true } })
    if (dbUser && dbUser.email !== email) {
      const from = dbUser.email
      await prisma.user.update({ where: { id }, data: { email } })
      await writeAuditLog(id, 'account.email.change', 'user', id, { from, to: email })
    }
  }

  return see(resolveRedirectPath(requestedNext, '/admin/account'))
}
