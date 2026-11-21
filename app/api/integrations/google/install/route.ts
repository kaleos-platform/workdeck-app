/**
 * POST /api/integrations/google/install
 * 연결 카드가 fetchWithMfa 로 호출한다(Origin 이 앱 도메인과 같아야 함 — 교차 사이트 시작 차단).
 * 로그인 + Space ADMIN + MFA aal2(만료면 403 MFA_REQUIRED → 카드가 제자리 인증 후 재전송).
 * 일회용 nonce 쿠키를 붙이고 Google 동의 주소를 { url } 로 돌려준다 — 이동은 카드가 한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_COOKIE_PATH,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_STATE_PURPOSE,
  googleAuthorizeUrl,
  requiredGoogleScopes,
} from '@/lib/agent/integrations/google-marketing'
import { readGoogle } from '@/lib/integrations/google-marketing-store'
import { OAUTH_STATE_TTL_SEC, createOAuthState } from '@/lib/integrations/oauth-state'
import { buildAppUrl, getAppOrigin } from '@/lib/domain'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== getAppOrigin()) {
    return errorResponse('잘못된 요청입니다', 403)
  }
  const form = await req.formData().catch(() => null)
  const spaceId = form?.get('spaceId')
  if (typeof spaceId !== 'string' || !spaceId) return errorResponse('잘못된 요청입니다', 400)

  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  const row = await readGoogle(spaceId)
  if (!row?.secret.clientId || !row.secret.clientSecret) {
    return errorResponse('먼저 클라이언트 ID·시크릿과 브랜드를 저장해 주세요', 400)
  }

  const created = createOAuthState(GOOGLE_STATE_PURPOSE, {
    spaceId,
    userId: auth.userId,
    clientId: row.secret.clientId,
  })
  if (!created) return errorResponse('Google 연동이 설정되지 않았습니다', 503)

  const res = NextResponse.json({
    url: googleAuthorizeUrl(
      row.secret.clientId,
      requiredGoogleScopes(row.config),
      created.state,
      buildAppUrl(GOOGLE_CALLBACK_PATH)
    ),
  })
  res.cookies.set(GOOGLE_NONCE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: GOOGLE_COOKIE_PATH,
    maxAge: OAUTH_STATE_TTL_SEC,
  })
  return res
}
