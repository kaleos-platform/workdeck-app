import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { prisma } from '@/lib/prisma'
import { AGENT_TOKEN_PREFIX, verifyAgentToken } from '@/lib/agent/identity/agent-token'
import { ALL_SCOPES, parseScopes, type McpPrincipal } from '@/lib/agent/identity/principal'

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

// Claude Code·Hermes처럼 헤더를 보낼 수 있는 클라이언트가 Space를 고를 때 쓰는 헤더.
export const SPACE_HEADER = 'x-workdeck-space-id'

type Resolution = { ok: true; principal: McpPrincipal } | { ok: false; reason: string } | null

function allowedClientIds(): string[] {
  return (process.env.MCP_ALLOWED_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function audIncludes(aud: unknown, expected: string): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected
}

/**
 * 구성원 OAuth 세션의 principal을 정한다. null = 401(계정 없음·허용 목록 밖).
 * { ok:false } = 인증은 됐지만 Space를 정할 수 없음 → 도구 호출 시 이유를 그대로 보여 준다
 * (401로 돌려주면 클라이언트가 OAuth 재로그인을 반복한다).
 */
export async function resolveUserPrincipal(
  userId: string,
  clientId: string,
  requestedSpaceId: string | null
): Promise<Resolution> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!user) return null

  const bound = await prisma.spaceAgent.findUnique({
    where: { oauthClientId: clientId },
    select: { id: true, spaceId: true, kind: true, scopes: true, status: true },
  })
  if (bound) {
    if (bound.kind !== 'integration')
      return { ok: false, reason: '연동 계정이 아닌 신원에 묶인 클라이언트입니다' }
    if (bound.status !== 'ACTIVE') return { ok: false, reason: '연동 계정이 비활성화되었습니다' }
    // 바인딩만으로 Space를 주지 않는다 — 사용자가 그 Space 구성원인지 다시 확인한다.
    const member = await prisma.spaceMember.findUnique({
      where: { spaceId_userId: { spaceId: bound.spaceId, userId } },
      select: { role: true },
    })
    if (!member) return { ok: false, reason: '연동 계정이 속한 Space의 구성원이 아닙니다' }
    return {
      ok: true,
      principal: {
        spaceId: bound.spaceId,
        actor: { type: 'integration', id: bound.id },
        scopes: parseScopes(bound.scopes),
      },
    }
  }

  const allow = allowedClientIds()
  if (allow.length > 0 && !allow.includes(clientId)) return null

  const memberships = await prisma.spaceMember.findMany({
    where: { userId },
    select: { spaceId: true },
  })
  const asUser = (spaceId: string): Resolution => ({
    ok: true,
    principal: { spaceId, actor: { type: 'user', id: userId }, scopes: ALL_SCOPES },
  })

  if (requestedSpaceId) {
    return memberships.some((m) => m.spaceId === requestedSpaceId)
      ? asUser(requestedSpaceId)
      : { ok: false, reason: '요청한 Space의 구성원이 아닙니다' }
  }
  if (memberships.length === 1) return asUser(memberships[0].spaceId)
  if (memberships.length === 0) return { ok: false, reason: '소속 Space가 없습니다' }
  return {
    ok: false,
    reason:
      `여러 Space에 속해 있어 Space를 정할 수 없습니다. ${SPACE_HEADER} 헤더를 보내거나, ` +
      `Space 관리자에게 이 클라이언트(client_id=${clientId})를 연동 계정에 연결해 달라고 요청하세요.`,
  }
}

/**
 * MCP bearer 토큰 검증기(withMcpAuth). 사람(Supabase OAuth JWT)과 에이전트(wdk_agt_) 토큰을 모두 받는다.
 * 결과 extra = { spaceId, actor, scopes } 또는 { authError }.
 *
 * Space 결정 규칙:
 *  1. `wdk_agt_` 토큰: 토큰의 에이전트가 속한 Space로 고정.
 *  2. Supabase JWT: getClaims(JWKS 서명 검증) 뒤 aud === 'authenticated',
 *     iss === `${NEXT_PUBLIC_SUPABASE_URL(끝 슬래시 제거)}/auth/v1`, client_id 필수(브라우저 세션 JWT 거부).
 *  3. client_id가 연동 계정(SpaceAgent.oauthClientId)에 묶여 있으면 actor = 연동 계정, Space = 그 Space.
 *     사용자는 그 Space 구성원이어야 한다.
 *  4. 묶여 있지 않으면 actor = user. `x-workdeck-space-id` 헤더(구성원이어야 함) → 멤버십 1개면 그 Space →
 *     2개 이상이면 client_id를 알려 주는 authError(최고참 멤버십으로 떨어지지 않는다).
 *  5. MCP_ALLOWED_CLIENT_IDS(쉼표 구분, 선택)가 있으면 바인딩되지 않은 client_id는 목록에 있을 때만 허용.
 *
 * 모든 예외(JWKS 실패·malformed 토큰·DB 오류·모르는 저장 scope)는 undefined(401)이다.
 * 로그에는 토큰 원문을 남기지 않는다.
 */
export async function verifyToken(
  req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  const isAgent = bearerToken.startsWith(AGENT_TOKEN_PREFIX)
  try {
    if (isAgent) {
      const principal = await verifyAgentToken(bearerToken)
      if (!principal) return undefined
      return {
        token: bearerToken,
        scopes: principal.scopes,
        clientId: principal.actor.id,
        extra: { ...principal },
      }
    }

    const { data, error } = await authClient().auth.getClaims(bearerToken)
    if (error || !data?.claims) return undefined
    const claims = data.claims as Record<string, unknown>
    const sub = typeof claims.sub === 'string' ? claims.sub : null
    const clientId =
      typeof claims.client_id === 'string' && claims.client_id ? claims.client_id : null
    const expectedIss = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/auth/v1`
    if (!sub || !clientId) return undefined
    if (!audIncludes(claims.aud, 'authenticated') || claims.iss !== expectedIss) return undefined

    const resolution = await resolveUserPrincipal(sub, clientId, req.headers.get(SPACE_HEADER))
    if (!resolution) return undefined
    if (!resolution.ok)
      return { token: bearerToken, scopes: [], clientId, extra: { authError: resolution.reason } }
    return {
      token: bearerToken,
      scopes: resolution.principal.scopes,
      clientId,
      extra: { ...resolution.principal },
    }
  } catch (err) {
    // 예외 메시지에는 토큰 일부(tokenId 등)가 섞일 수 있어 종류만 남긴다.
    console.error(
      `[mcp-auth] ${isAgent ? '에이전트 토큰' : 'JWT'} 검증 중 예외 → 401`,
      err instanceof Error ? err.name : typeof err
    )
    return undefined
  }
}
