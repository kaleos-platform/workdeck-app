import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          // 갱신된 쿠키를 다음 Server Component 요청에도 전달한다.
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  const pathname = request.nextUrl.pathname
  if (pathname === '/d/coupang-ads' || /^\/d\/coupang-ads\/campaigns\/[^/]+$/.test(pathname)) {
    // 이 두 화면은 서버의 getUser·권한 검사를 유지한다. Proxy에서는 서명·만료 검증과 갱신만 한다.
    const { data, error } = await supabase.auth.getClaims()
    return { supabaseResponse, authenticated: !error && Boolean(data?.claims?.sub) }
  }

  // 나머지 경로는 기존 서버 사용자 조회를 유지한다.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  return { supabaseResponse, authenticated: !error && Boolean(user) }
}
