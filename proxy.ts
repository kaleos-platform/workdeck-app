import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  // 보호된 라우트 정의 (로그인 필수)
  const protectedRoutes = ['/dashboard', '/workspace-setup']
  const isProtectedRoute = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // 비로그인 전용 라우트 정의
  const authOnlyRoutes = ['/login', '/signup']
  const isAuthOnlyRoute = authOnlyRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // 1. 보호된 라우트인데 로그인 안 되어 있으면 /login으로 이동
  if (isProtectedRoute && !user) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirectTo', request.nextUrl.pathname)
    return Response.redirect(redirectUrl)
  }

  // 2. 이미 로그인했는데 비로그인 전용 페이지 접근하면 /dashboard로 이동
  if (isAuthOnlyRoute && user) {
    return Response.redirect(new URL('/dashboard', request.url))
  }

  // TODO: 워크스페이스 미생성 사용자가 /dashboard 접근 시 /workspace-setup으로 리다이렉트
  // 워크스페이스 존재 여부 확인은 proxy 단계에서 Prisma 직접 호출이 어려우므로
  // dashboard layout.tsx의 서버 컴포넌트에서 처리 예정

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
