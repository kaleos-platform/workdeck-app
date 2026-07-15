import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { prisma } from '@/lib/prisma'

// 쿠키 없는 stateless Supabase 클라이언트 — bearer 토큰 검증 전용.
// 세션/쿠키 저장을 끄고 순수 JWKS 검증에만 사용한다.
// 지연 생성(첫 호출 시): 모듈 로드 시점(빌드의 page-data 수집 포함)에는
// 환경변수가 없어 createClient가 "supabaseUrl is required"로 던지므로,
// storage.ts 패턴처럼 요청 시점에 캐시 생성한다.
let cached: SupabaseClient | null = null

function authClient(): SupabaseClient {
  if (cached) return cached
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase 환경변수가 설정되지 않았습니다')
  cached = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return cached
}

/**
 * MCP OAuth bearer 토큰 검증기 (withMcpAuth의 verifyToken).
 *
 * 검증 흐름:
 *  1. bearer 토큰이 없으면 즉시 undefined → withMcpAuth가 401 응답.
 *  2. supabase.auth.getClaims(token)로 JWKS 비대칭 로컬 검증.
 *     - 옵션 없는 getClaims는 SDK가 서버 캐시 JWKS를 자동 사용한다.
 *       (첫 호출은 JWKS를 받기 위해 네트워크 요청이 발생할 수 있고,
 *        이후 호출은 캐시된 키로 로컬 검증한다.)
 *     - 프로젝트가 레거시 HS256 대칭 토큰을 발급하는 경우 로컬 검증이
 *       네트워크 검증으로 저하될 수 있으나 동작에는 문제 없다.
 *  3. claims.sub(Supabase user id)로 실제 User 존재를 확인한다.
 *     User가 없으면 undefined(토큰은 유효하나 앱 계정이 없는 경우).
 *
 * malformed 토큰은 getClaims가 error 또는 null claims를 주므로
 * try/catch로 감싸 어떤 실패든 undefined를 반환한다(= 401).
 */
export async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined

  try {
    const { data, error } = await authClient().auth.getClaims(bearerToken)
    if (error || !data?.claims) return undefined

    const claims = data.claims
    const sub = claims.sub
    if (!sub) return undefined

    // 실제 앱 User 존재 확인 — Supabase 토큰만으로는 부족하다.
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true },
    })
    if (!user) return undefined

    return {
      token: bearerToken,
      scopes: [],
      clientId: (claims.client_id as string | undefined) ?? sub,
      extra: { userId: user.id },
    }
  } catch {
    // JWKS 검증 실패·malformed 토큰·DB 오류 등 모든 예외 → 인증 실패 처리
    return undefined
  }
}
