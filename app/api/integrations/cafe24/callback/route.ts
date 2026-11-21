/**
 * GET /api/integrations/cafe24/callback
 * 카페24 승인 후 돌아오는 콜백. state 서명·만료 + nonce 쿠키(일회용) + 현재 사용자 = state.userId +
 * ADMIN + aal2 를 확인하고, code 를 토큰으로 교환해 조건부 쓰기로 저장한 뒤 주문 조회 1회로 동작을 확인한다.
 * 결과: /settings/integrations?open=cafe24&cafe24=<connected|denied|error|mall_mismatch|scope_missing|mfa_required|forbidden|expired>&spaceId=…
 * state 서명이 무효면 spaceId 를 믿을 수 없어 spaceId 없이 돌려보낸다.
 * 토큰·응답 본문은 어디에도 기록하지 않는다(오류는 단계명+상태+허용된 코드만).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { requireAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { recordCredentialError } from '@/lib/agent/integrations/space-credential'
import { exchangeCode, hasOrderScopes, probeOrders } from '@/lib/cafe24/client'
import {
  CAFE24_COOKIE_PATH,
  CAFE24_NONCE_COOKIE,
  nonceMatches,
  verifyCafe24State,
  type Cafe24StatePayload,
} from '@/lib/cafe24/oauth-state'
import { readCafe24, writeCafe24If } from '@/lib/cafe24/store'
import { buildAppUrl } from '@/lib/domain'

export const runtime = 'nodejs'

type Outcome =
  | 'connected'
  | 'denied'
  | 'error'
  | 'mall_mismatch'
  | 'scope_missing'
  | 'mfa_required'
  | 'forbidden'
  | 'expired'

/** nonce 쿠키는 결과와 상관없이 지운다(재사용 차단). */
function done(status: Outcome, spaceId?: string, mallId?: string): NextResponse {
  const q = new URLSearchParams({ open: 'cafe24', cafe24: status })
  if (spaceId) q.set('spaceId', spaceId) // 서명 검증된 state 값만 넣는다
  if (mallId) q.set('mall', mallId)
  const res = NextResponse.redirect(buildAppUrl(`/settings/integrations?${q.toString()}`))
  res.cookies.set(CAFE24_NONCE_COOKIE, '', { path: CAFE24_COOKIE_PATH, maxAge: 0 })
  return res
}

const sameApp = (row: NonNullable<Awaited<ReturnType<typeof readCafe24>>>, s: Cafe24StatePayload) =>
  row.secret.clientId === s.clientId && row.config.mallId === s.mallId

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const stateParam = url.searchParams.get('state')
  const state = stateParam ? verifyCafe24State(stateParam) : null
  if (!state) return done('expired') // 서명이 무효라 spaceId 를 믿을 수 없다

  const user = await getUser()
  if (!user || user.id !== state.userId) return done('forbidden', state.spaceId, state.mallId)
  // 쿠키 대조 — 다른 브라우저 세션·재사용 차단
  if (!nonceMatches(state, req.cookies.get(CAFE24_NONCE_COOKIE)?.value)) {
    return done('expired', state.spaceId, state.mallId)
  }
  const auth = await requireSpaceAdmin(state.spaceId)
  if ('error' in auth) return done('forbidden', state.spaceId, state.mallId)
  if (await requireAal2()) return done('mfa_required', state.spaceId, state.mallId)

  if (url.searchParams.get('error')) return done('denied', state.spaceId, state.mallId)
  const code = url.searchParams.get('code')
  if (!code) return done('error', state.spaceId, state.mallId)

  const row = await readCafe24(state.spaceId, state.mallId)
  if (!row || !sameApp(row, state)) return done('error', state.spaceId, state.mallId) // 승인 도중 설정이 바뀜

  let tokens
  try {
    // install 과 바이트 동일해야 한다.
    tokens = await exchangeCode(
      row.config.mallId,
      row.secret.clientId,
      row.secret.clientSecret,
      code,
      buildAppUrl('/api/integrations/cafe24/callback')
    )
  } catch (err) {
    await recordCredentialError(row.id, err instanceof Error ? err.message : '카페24 승인 실패')
    return done('error', state.spaceId, state.mallId)
  }
  if (tokens.mallId !== row.config.mallId) return done('mall_mismatch', state.spaceId, state.mallId)
  if (!hasOrderScopes(tokens.scopes)) return done('scope_missing', state.spaceId, state.mallId)

  // 토큰 저장(조건부 쓰기). 버전만 바뀌었으면 1회 재시도, 설정이 바뀌었으면 저장하지 않는다.
  let saved = false
  for (let attempt = 0; attempt < 2 && !saved; attempt++) {
    const cur = attempt === 0 ? row : await readCafe24(state.spaceId, state.mallId)
    if (!cur || !sameApp(cur, state)) return done('error', state.spaceId, state.mallId)
    saved = await writeCafe24If(
      cur,
      { ...cur.secret, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      {
        mallId: cur.config.mallId,
        status: 'needs_auth', // 주문 조회 확인 뒤에 connected
        accessExpiresAt: tokens.accessExpiresAt,
        refreshExpiresAt: tokens.refreshExpiresAt,
        scopes: tokens.scopes,
      },
      true
    )
  }
  if (!saved) return done('error', state.spaceId, state.mallId)

  try {
    await probeOrders(state.spaceId, state.mallId)
  } catch (err) {
    await recordCredentialError(
      row.id,
      err instanceof Error ? err.message : '카페24 주문 조회 실패'
    )
    return done('error', state.spaceId, state.mallId)
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await readCafe24(state.spaceId, state.mallId)
    if (!cur || !sameApp(cur, state)) return done('error', state.spaceId, state.mallId)
    const ok = await writeCafe24If(
      cur,
      cur.secret,
      {
        ...cur.config,
        status: 'connected',
        connectedAt: new Date().toISOString(),
        connectedBy: user.id,
      },
      true
    )
    if (ok) return done('connected', state.spaceId, state.mallId)
  }
  return done('error', state.spaceId, state.mallId)
}
