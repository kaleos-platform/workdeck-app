import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveRedirectPath, sanitizeRedirectPath } from '@/lib/auth-redirect'
import { prisma } from '@/lib/prisma'

// GET /auth/callback?code=... — 구글 OAuth 코드를 세션으로 교환
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const type = searchParams.get('type') // 'email': 이메일 인증 콜백, null: Google OAuth 콜백
  const requestedNext = sanitizeRedirectPath(searchParams.get('next'))
  const next = resolveRedirectPath(requestedNext)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // 비밀번호 재설정 (type=recovery) → 세션 유지 후 비밀번호 재설정 페이지로
      if (type === 'recovery') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }

      // 이메일 인증 완료 (type=email) → 세션 종료 후 로그인 화면으로 리다이렉트
      // app_metadata.provider가 아닌 URL 파라미터로 구분 (동일 이메일로 여러 provider 연결 시 오작동 방지)
      if (type === 'email') {
        await supabase.auth.signOut()
        const params = new URLSearchParams({ verified: 'success' })
        if (requestedNext) {
          params.set('redirectTo', requestedNext)
        }
        const loginPath = requestedNext?.match(/^\/d\/[^/]+$/) ? `${requestedNext}/login` : '/login'
        return NextResponse.redirect(`${origin}${loginPath}?${params.toString()}`)
      }

      // Google OAuth → Prisma User upsert 후 대시보드로
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        await prisma.user.upsert({
          where: { id: user.id },
          create: {
            id: user.id,
            email: user.email ?? '',
            name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
          },
          update: {
            email: user.email ?? '',
          },
        })

        // 워크스페이스 존재 여부 확인 → 없으면 초기 설정 페이지로
        const workspace = await prisma.workspace.findUnique({
          where: { ownerId: user.id },
          select: { id: true },
        })

        if (!workspace) {
          return NextResponse.redirect(`${origin}/workspace-setup`)
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // 에러 시 로그인 페이지로 (에러 파라미터 포함)
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
