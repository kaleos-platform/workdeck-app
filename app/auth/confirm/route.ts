import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { sanitizeRedirectPath, resolveRedirectPath } from '@/lib/auth-redirect'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/admin/auth'

// GET /auth/confirm?token_hash=...&type=...&next=... — OTP(token_hash) 기반 이메일 링크 확인 콜백.
// 계정 이메일 변경 등 세션 없는 기기/메일 앱에서도 열릴 수 있어, verifyOtp 응답의 user를 직접 사용한다.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const requestedNext = sanitizeRedirectPath(searchParams.get('next'))
  const next = resolveRedirectPath(requestedNext, '/admin/account')

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })

  if (error || !data.user) {
    // 초대 메일 링크(OTP)는 초대(7일)보다 빨리 만료된다 — 초대 화면으로 보내 로그인·가입 후 수락하게 한다.
    if (requestedNext?.startsWith('/invite/')) {
      return NextResponse.redirect(`${origin}${requestedNext}`)
    }
    return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
  }

  // 이메일 변경 확인 — Supabase user.email과 prisma 값이 다를 때만 동기화(감사 로그는 여기서만 기록)
  if (type === 'email_change' && data.user.email) {
    const { id, email } = data.user
    const dbUser = await prisma.user.findUnique({ where: { id }, select: { email: true } })
    if (dbUser && dbUser.email !== email) {
      const from = dbUser.email
      await prisma.user.update({ where: { id }, data: { email } })
      await writeAuditLog(id, 'account.email.change', 'user', id, { from, to: email })
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
