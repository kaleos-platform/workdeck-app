/**
 * GET /api/admin/platform/google/callback
 * state(purpose 분리)·nonce 쿠키(일회용)·현재 사용자 = state.userId·OPERATOR·aal2(항상)·clientId 동일을 확인하고,
 * code 를 토큰으로 교환해 조건부 저장(needs_check) → 스트림 조회 성공 시 connected. 변경마다 감사 로그(같은 transaction).
 * 결과: /admin/integrations?google=<connected|denied|error|scope_missing|property_denied|mfa_required|forbidden|expired>
 * 토큰·응답 본문은 기록하지 않는다(오류는 단계명+상태+허용 코드만).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { isAal2Fresh } from '@/lib/auth/mfa'
import {
  GoogleOAuthError,
  exchangeGoogleCode,
  hasGoogleScopes,
} from '@/lib/agent/integrations/google-marketing'
import {
  PLATFORM_CALLBACK_PATH,
  PLATFORM_COOKIE_PATH,
  PLATFORM_NONCE_COOKIE,
  PLATFORM_SCOPES,
  PLATFORM_STATE_PURPOSE,
  readPlatformGoogle,
  recordPlatformError,
  writePlatformGoogleIf,
  type PlatformRow,
} from '@/lib/admin/platform-google'
import { fetchMeasurementId } from '@/lib/admin/platform-ga4'
import { oauthNonceMatches, verifyOAuthState } from '@/lib/integrations/oauth-state'
import { buildAdminUrl } from '@/lib/domain'

export const runtime = 'nodejs'

type Outcome =
  | 'connected'
  | 'denied'
  | 'error'
  | 'scope_missing'
  | 'property_denied'
  | 'mfa_required'
  | 'forbidden'
  | 'expired'

/** nonce 쿠키는 결과와 상관없이 지운다(재사용 차단). */
function done(status: Outcome): NextResponse {
  const res = NextResponse.redirect(buildAdminUrl(`/admin/integrations?google=${status}`))
  res.cookies.set(PLATFORM_NONCE_COOKIE, '', { path: PLATFORM_COOKIE_PATH, maxAge: 0 })
  return res
}

const safeMessage = (err: unknown, fallback: string) =>
  err instanceof GoogleOAuthError ? err.message : fallback

export async function GET(req: NextRequest) {
  try {
    return await handle(req)
  } catch {
    return done('error')
  }
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url)
  const stateParam = url.searchParams.get('state')
  const state = stateParam ? verifyOAuthState(PLATFORM_STATE_PURPOSE, stateParam) : null
  if (!state || state.spaceId !== 'platform') return done('expired')

  const op = await requireOperator()
  if (!op.ok && op.reason === 'NOT_OPERATOR') return done('forbidden')
  if (op.user.id !== state.userId) return done('forbidden')
  if (!oauthNonceMatches(state, req.cookies.get(PLATFORM_NONCE_COOKIE)?.value)) {
    return done('expired')
  }
  // ADMIN_REQUIRE_MFA=false 여도 이 경로는 aal2 를 요구한다.
  if (!(await isAal2Fresh())) return done('mfa_required')

  if (url.searchParams.get('error')) return done('denied')
  const code = url.searchParams.get('code')
  if (!code) return done('error')

  const row = await readPlatformGoogle()
  if (!row || row.secret.clientId !== state.clientId || !row.secret.clientSecret) {
    return done('error') // 승인 도중 설정이 바뀜
  }

  let tokens
  try {
    // install 과 바이트 동일해야 한다.
    tokens = await exchangeGoogleCode(
      row.secret.clientId,
      row.secret.clientSecret,
      code,
      buildAdminUrl(PLATFORM_CALLBACK_PATH)
    )
  } catch (err) {
    await recordPlatformError(row.id, safeMessage(err, 'Google 승인 실패'))
    return done('error')
  }
  if (!tokens.refreshToken) {
    await recordPlatformError(row.id, 'Google 승인 실패: refresh token 이 발급되지 않았습니다')
    return done('error')
  }
  const refreshToken = tokens.refreshToken
  // 반환 scope 에 다른 권한이 섞여도 필수(analytics.readonly) 포함만 본다. 저장은 반환 그대로.
  const scopeMissing = !hasGoogleScopes(tokens.scopes, PLATFORM_SCOPES)

  // 토큰 저장 — 버전만 바뀌었으면 재시도, 설정(clientId)이 바뀌었으면 저장하지 않는다.
  let saved: PlatformRow | null = null
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    const cur = attempt === 0 ? row : await readPlatformGoogle()
    if (!cur || cur.secret.clientId !== state.clientId) return done('error')
    const next = {
      propertyId: cur.config.propertyId,
      streamId: cur.config.streamId,
      scopes: tokens.scopes,
      status: scopeMissing ? ('needs_auth' as const) : ('needs_check' as const),
    }
    const ok = await writePlatformGoogleIf(cur, { ...cur.secret, refreshToken }, next, {
      actorUserId: op.user.id,
      action: 'platform.google.connect',
      meta: { stage: 'token', status: next.status },
    })
    if (ok) {
      saved = {
        ...cur,
        secret: { ...cur.secret, refreshToken },
        config: { ...next, credVersion: cur.config.credVersion + 1 },
      }
    }
  }
  if (!saved) return done('error')
  if (scopeMissing) return done('scope_missing')

  try {
    await fetchMeasurementId(tokens.accessToken, saved.config.propertyId, saved.config.streamId)
  } catch (err) {
    // 토큰은 유지 — 속성/스트림 권한을 고친 뒤 「다시 연결」 로 복구한다.
    await recordPlatformError(saved.id, safeMessage(err, 'GA4 스트림 확인 실패'))
    return done('property_denied')
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readPlatformGoogle()
    // 확인한 뒤 토큰·속성·스트림이 바뀌었으면 승격하지 않는다(needs_check 유지).
    if (
      !cur ||
      cur.secret.refreshToken !== refreshToken ||
      cur.config.propertyId !== saved.config.propertyId ||
      cur.config.streamId !== saved.config.streamId
    ) {
      return done('error')
    }
    const ok = await writePlatformGoogleIf(
      cur,
      cur.secret,
      {
        propertyId: cur.config.propertyId,
        streamId: cur.config.streamId,
        scopes: cur.config.scopes,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        connectedBy: op.user.id,
      },
      {
        actorUserId: op.user.id,
        action: 'platform.google.connect',
        meta: { stage: 'verified', status: 'connected' },
      }
    )
    if (ok) return done('connected')
  }
  return done('error')
}
