import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'

// GET /auth/callback?code=... — 구글 OAuth 코드를 세션으로 교환
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        // Prisma User upsert (최초 구글 로그인 시 User 레코드 생성)
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
