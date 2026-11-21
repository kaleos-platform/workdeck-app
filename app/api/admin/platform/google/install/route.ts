/**
 * POST /api/admin/platform/google/install — Google 동의 주소 발급.
 * Origin = 어드민 오리진, OPERATOR + aal2(항상). 일회용 nonce 쿠키를 붙이고 { url } 을 돌려준다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { requireFreshAal2 } from '@/lib/auth/mfa'
import { googleAuthorizeUrl } from '@/lib/agent/integrations/google-marketing'
import {
  PLATFORM_CALLBACK_PATH,
  PLATFORM_COOKIE_PATH,
  PLATFORM_NONCE_COOKIE,
  PLATFORM_SCOPES,
  PLATFORM_STATE_PURPOSE,
  readPlatformGoogle,
} from '@/lib/admin/platform-google'
import { OAUTH_STATE_TTL_SEC, createOAuthState } from '@/lib/integrations/oauth-state'
import { buildAdminUrl, getAdminOrigin } from '@/lib/domain'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  if (req.headers.get('origin') !== getAdminOrigin()) {
    return errorResponse('잘못된 요청입니다', 403)
  }
  const mfa = await requireFreshAal2()
  if (mfa) return mfa

  const row = await readPlatformGoogle()
  if (!row?.secret.clientId || !row.secret.clientSecret) {
    return errorResponse('먼저 클라이언트 ID·시크릿과 속성·스트림을 저장해 주세요', 400)
  }
  // 'platform' 고정 — 고객용 callback 은 purpose 가 달라 이 state 를 받지 않는다.
  const created = createOAuthState(PLATFORM_STATE_PURPOSE, {
    spaceId: 'platform',
    userId: auth.user.id,
    clientId: row.secret.clientId,
  })
  if (!created) return errorResponse('Google 연동이 설정되지 않았습니다', 503)

  const res = NextResponse.json({
    url: googleAuthorizeUrl(
      row.secret.clientId,
      PLATFORM_SCOPES,
      created.state,
      buildAdminUrl(PLATFORM_CALLBACK_PATH),
      { includeGrantedScopes: false }
    ),
  })
  res.cookies.set(PLATFORM_NONCE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: PLATFORM_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_SEC,
  })
  return res
}
