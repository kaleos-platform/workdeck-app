/**
 * GET /api/integrations/google/callback
 * Google 동의 후 돌아오는 콜백. state 서명·만료 + nonce 쿠키(일회용) + 현재 사용자 = state.userId +
 * ADMIN + aal2 를 확인하고, code 를 토큰으로 교환해 조건부 쓰기(credVersion)로 저장한 뒤 브랜드 GA4 속성 조회로 동작을 확인한다.
 * 저장은 status needs_check 로 하고, 속성 조회가 성공해야 connected 로 올린다.
 * 모든 쓰기 시도는 그 시점의 config 로 필수 범위를 다시 계산한다(저장과 콜백이 교차해 GTM 이 추가돼도 덮이지 않게).
 * 결과: /settings/integrations?open=google-marketing&google=<connected|denied|error|scope_missing|property_denied|mfa_required|forbidden|expired>&spaceId=…
 * state 서명이 무효면 spaceId 를 믿을 수 없어 spaceId 없이 돌려보낸다.
 * 토큰·응답 본문은 어디에도 기록하지 않는다(오류는 단계명+상태+허용된 코드만).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { requireAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { recordCredentialError } from '@/lib/agent/integrations/space-credential'
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_COOKIE_PATH,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_STATE_PURPOSE,
  exchangeGoogleCode,
  hasGoogleScopes,
  requiredGoogleScopes,
  verifyGoogleBrands,
} from '@/lib/agent/integrations/google-marketing'
import {
  readGoogle,
  writeGoogleIf,
  type GoogleRow,
} from '@/lib/integrations/google-marketing-store'
import {
  oauthNonceMatches,
  verifyOAuthState,
  type OAuthStatePayload,
} from '@/lib/integrations/oauth-state'
import { buildAppUrl } from '@/lib/domain'

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
function done(status: Outcome, spaceId?: string): NextResponse {
  const q = new URLSearchParams({ open: 'google-marketing', google: status })
  if (spaceId) q.set('spaceId', spaceId) // 서명 검증된 state 값만 넣는다
  const res = NextResponse.redirect(buildAppUrl(`/settings/integrations?${q.toString()}`))
  res.cookies.set(GOOGLE_NONCE_COOKIE, '', { path: GOOGLE_COOKIE_PATH, maxAge: 0 })
  return res
}

const sameClient = (row: GoogleRow, s: OAuthStatePayload) => row.secret.clientId === s.clientId

// 검증 대상(브랜드→속성) 식별 — 검증 뒤 브랜드가 바뀌었으면 승격하지 않는다.
const brandKey = (row: GoogleRow) =>
  JSON.stringify(
    Object.entries(row.config.brands)
      .map(([b, v]) => [b, v.ga4_property_id])
      .sort()
  )

const safeMessage = (err: unknown, fallback: string) =>
  err instanceof Error && err.name === 'GoogleOAuthError' ? err.message : fallback

// DB·복호화 등 예상 밖 예외에도 nonce 쿠키를 지우고 결과 화면으로 돌려보낸다(원문 500 노출 금지).
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
  const state = stateParam ? verifyOAuthState(GOOGLE_STATE_PURPOSE, stateParam) : null
  if (!state) return done('expired') // 서명이 무효라 spaceId 를 믿을 수 없다

  const user = await getUser()
  if (!user || user.id !== state.userId) return done('forbidden', state.spaceId)
  // 쿠키 대조 — 다른 브라우저 세션·재사용 차단
  if (!oauthNonceMatches(state, req.cookies.get(GOOGLE_NONCE_COOKIE)?.value)) {
    return done('expired', state.spaceId)
  }
  const auth = await requireSpaceAdmin(state.spaceId)
  if ('error' in auth) return done('forbidden', state.spaceId)
  if (await requireAal2()) return done('mfa_required', state.spaceId)

  if (url.searchParams.get('error')) return done('denied', state.spaceId)
  const code = url.searchParams.get('code')
  if (!code) return done('error', state.spaceId)

  const row = await readGoogle(state.spaceId)
  if (!row || !sameClient(row, state) || !row.secret.clientSecret) {
    return done('error', state.spaceId) // 승인 도중 설정이 바뀜
  }

  let tokens
  try {
    // install 과 바이트 동일해야 한다.
    tokens = await exchangeGoogleCode(
      row.secret.clientId,
      row.secret.clientSecret,
      code,
      buildAppUrl(GOOGLE_CALLBACK_PATH)
    )
  } catch (err) {
    await recordCredentialError(row.id, safeMessage(err, 'Google 승인 실패'))
    return done('error', state.spaceId)
  }
  // 이미 동의한 앱은 refresh token 을 다시 주지 않는다(prompt=consent 로 막지만 방어).
  if (!tokens.refreshToken) {
    await recordCredentialError(row.id, 'Google 승인 실패: refresh token 이 발급되지 않았습니다')
    return done('error', state.spaceId)
  }
  const refreshToken = tokens.refreshToken

  // 토큰 저장(조건부 쓰기). 버전만 바뀌었으면 재시도, 설정이 바뀌었으면 저장하지 않는다.
  // 시도마다 그 시점 config 로 필수 범위를 다시 계산한다 — 부족하면 토큰은 저장하되 needs_auth.
  let saved: GoogleRow | null = null
  let scopeMissing = false
  for (let attempt = 0; attempt < 3 && !saved; attempt++) {
    const cur = attempt === 0 ? row : await readGoogle(state.spaceId)
    if (!cur || !sameClient(cur, state)) return done('error', state.spaceId)
    scopeMissing = !hasGoogleScopes(tokens.scopes, requiredGoogleScopes(cur.config))
    const next = {
      defaultBrand: cur.config.defaultBrand,
      brands: cur.config.brands,
      scopes: tokens.scopes,
      status: scopeMissing ? ('needs_auth' as const) : ('needs_check' as const), // 속성 확인 뒤에 connected
    }
    if (await writeGoogleIf(cur, { ...cur.secret, refreshToken }, next, true)) {
      saved = {
        ...cur,
        secret: { ...cur.secret, refreshToken },
        config: { ...next, credVersion: cur.config.credVersion + 1 },
      }
    }
  }
  if (!saved) return done('error', state.spaceId)
  if (scopeMissing) return done('scope_missing', state.spaceId)

  try {
    await verifyGoogleBrands(
      { id: saved.id, secret: saved.secret, config: saved.config },
      tokens.accessToken
    )
  } catch (err) {
    // 토큰은 유지 — 속성 권한만 고치면 health 가 승격하고, 「다시 연결」 로도 복구된다.
    await recordCredentialError(saved.id, safeMessage(err, 'Google 속성 확인 실패'))
    return done('property_denied', state.spaceId)
  }
  const verifiedKey = brandKey(saved)

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readGoogle(state.spaceId)
    // 확인한 뒤 토큰·브랜드가 바뀌었으면 승격하지 않는다(needs_check 유지 → health 가 다시 확인).
    if (!cur || !sameClient(cur, state) || cur.secret.refreshToken !== refreshToken) {
      return done('error', state.spaceId)
    }
    if (brandKey(cur) !== verifiedKey) return done('error', state.spaceId)
    const missing = !hasGoogleScopes(cur.config.scopes, requiredGoogleScopes(cur.config))
    const ok = await writeGoogleIf(
      cur,
      cur.secret,
      {
        defaultBrand: cur.config.defaultBrand,
        brands: cur.config.brands,
        scopes: cur.config.scopes,
        ...(missing
          ? { status: 'needs_auth' as const }
          : { status: 'connected' as const, connectedAt: new Date().toISOString() }),
      },
      true
    )
    if (ok) return done(missing ? 'scope_missing' : 'connected', state.spaceId)
  }
  return done('error', state.spaceId)
}
