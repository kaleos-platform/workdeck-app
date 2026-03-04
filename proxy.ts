import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { resolveRedirectPath } from '@/lib/auth-redirect'
import {
  buildAppUrl,
  buildMarketingUrl,
  isAppHost,
  isMarketingHost,
  normalizeHost,
} from '@/lib/domain'

function isPathOrChild(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`)
}

function getRequestPathWithQuery(request: NextRequest) {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`
}

function getDeckEntryPath(pathname: string): string | null {
  const matched = pathname.match(/^\/d\/([^/]+)$/)
  if (!matched) return null
  const deckKey = matched[1]
  if (!deckKey) return null
  return `/d/${deckKey}`
}

function getDeckLoginPath(pathname: string): string | null {
  const matched = pathname.match(/^\/d\/([^/]+)\/login$/)
  if (!matched) return null
  const deckKey = matched[1]
  if (!deckKey) return null
  return `/d/${deckKey}/login`
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname, searchParams } = request.nextUrl
  const host = normalizeHost(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))

  const isMarketingDomain = isMarketingHost(host)
  const isAppDomain = isAppHost(host)
  const isDeckEntryRoute = Boolean(getDeckEntryPath(pathname))
  const isDeckLoginRoute = Boolean(getDeckLoginPath(pathname))

  // 도메인 정책:
  // - marketing(workdeck.work): 마케팅 경로만 허용
  // - app(app.workdeck.work): 앱 경로 중심으로 운영
  if (isMarketingDomain) {
    const appOnlyPaths = [
      '/login',
      '/signup',
      '/dashboard',
      '/workspace-setup',
      '/my-deck',
      '/space',
      '/d',
      '/api',
      '/auth',
    ]
    const shouldMoveToApp = appOnlyPaths.some((base) => isPathOrChild(pathname, base))
    if (shouldMoveToApp) {
      return NextResponse.redirect(buildAppUrl(getRequestPathWithQuery(request)))
    }
  }

  if (isAppDomain) {
    if (pathname === '/') {
      return NextResponse.redirect(buildAppUrl('/my-deck'))
    }
    if (isPathOrChild(pathname, '/coupang-ads')) {
      return NextResponse.redirect(buildMarketingUrl(getRequestPathWithQuery(request)))
    }
  }

  // 보호된 라우트 정의 (로그인 필수)
  const protectedRoutes = ['/dashboard', '/workspace-setup', '/my-deck', '/space']
  const isProtectedRoute =
    isDeckEntryRoute || protectedRoutes.some((route) => isPathOrChild(pathname, route))

  // 비로그인 전용 라우트 정의
  const authOnlyRoutes = ['/login', '/signup']
  const isAuthOnlyRoute =
    isDeckLoginRoute || authOnlyRoutes.some((route) => isPathOrChild(pathname, route))

  // 보호된 라우트인데 로그인 안 되어 있으면 로그인 페이지로 이동
  if (isProtectedRoute && !user) {
    if (isDeckEntryRoute) {
      const deckPath = getDeckEntryPath(pathname)
      if (deckPath) {
        return NextResponse.redirect(buildAppUrl(`${deckPath}/login`))
      }
    }

    const redirectTo = getRequestPathWithQuery(request)
    return NextResponse.redirect(buildAppUrl(`/login?redirectTo=${encodeURIComponent(redirectTo)}`))
  }

  // 이미 로그인했는데 비로그인 전용 페이지 접근하면 목적지로 이동
  if (isAuthOnlyRoute && user) {
    if (isDeckLoginRoute) {
      const deckPath = getDeckLoginPath(pathname)
      if (deckPath) {
        return NextResponse.redirect(buildAppUrl(deckPath.replace(/\/login$/, '')))
      }
    }
    const redirectTo = resolveRedirectPath(searchParams.get('redirectTo'))
    return NextResponse.redirect(buildAppUrl(redirectTo))
  }

  // TODO: 워크스페이스 미생성 사용자가 /dashboard 접근 시 /workspace-setup으로 리다이렉트
  // 워크스페이스 존재 여부 확인은 proxy 단계에서 Prisma 직접 호출이 어려우므로
  // dashboard layout.tsx의 서버 컴포넌트에서 처리 예정

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
