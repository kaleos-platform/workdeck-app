/**
 * POST /api/integrations/cafe24/install
 * 연결 카드가 fetchWithMfa 로 호출한다(Origin 이 앱 도메인과 같아야 함 — 교차 사이트 시작 차단).
 * 로그인 + Space ADMIN + MFA aal2(만료면 403 MFA_REQUIRED → 카드가 제자리 인증 후 재전송).
 * 일회용 nonce 쿠키를 붙이고 카페24 authorize 주소를 { url } 로 돌려준다 — 이동은 카드가 한다.
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { requireAal2 } from '@/lib/auth/mfa'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { MALL_ID_RE, authorizeUrl } from '@/lib/cafe24/client'
import {
  CAFE24_COOKIE_PATH,
  CAFE24_NONCE_COOKIE,
  CAFE24_STATE_TTL_SEC,
  createCafe24State,
} from '@/lib/cafe24/oauth-state'
import { readCafe24 } from '@/lib/cafe24/store'
import { buildAppUrl, getAppOrigin } from '@/lib/domain'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== getAppOrigin()) {
    return errorResponse('잘못된 요청입니다', 403)
  }
  const form = await req.formData().catch(() => null)
  const spaceId = form?.get('spaceId')
  const mallId = form?.get('mallId')
  if (typeof spaceId !== 'string' || !spaceId) return errorResponse('잘못된 요청입니다', 400)
  if (typeof mallId !== 'string' || !MALL_ID_RE.test(mallId)) {
    return errorResponse('잘못된 요청입니다', 400)
  }

  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  const mfaError = await requireAal2()
  if (mfaError) return mfaError

  const row = await readCafe24(spaceId, mallId)
  if (!row) return errorResponse('먼저 쇼핑몰을 추가해 주세요', 400)

  const created = createCafe24State({
    spaceId,
    userId: auth.userId,
    clientId: row.secret.clientId,
    mallId: row.config.mallId,
  })
  if (!created) return errorResponse('카페24 연동이 설정되지 않았습니다', 503)

  const redirectUri = buildAppUrl('/api/integrations/cafe24/callback')
  const res = NextResponse.json({
    url: authorizeUrl(row.config.mallId, row.secret.clientId, created.state, redirectUri),
  })
  res.cookies.set(CAFE24_NONCE_COOKIE, created.nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: CAFE24_COOKIE_PATH,
    maxAge: CAFE24_STATE_TTL_SEC,
  })
  return res
}
