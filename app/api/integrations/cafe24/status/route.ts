/**
 * GET /api/integrations/cafe24/status?spaceId=…
 * 연결 카드용 상태(ADMIN 이상). 시크릿·토큰·clientId 는 돌려주지 않는다(복호화하지 않고 config 와 오류 문구만 읽는다).
 * malls = 연결된 쇼핑몰(레거시 행 포함, mallId 오름차순), appConfigured = 앱 정보가 저장된 쇼핑몰이 하나라도 있음.
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { MAX_MALLS, listCafe24Malls } from '@/lib/cafe24/store'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const spaceId = req.nextUrl.searchParams.get('spaceId')
  if (!spaceId) return errorResponse('잘못된 요청입니다', 400)
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error

  const malls = await listCafe24Malls(spaceId)
  return NextResponse.json(
    {
      appConfigured: malls.length > 0,
      limit: MAX_MALLS,
      malls: malls.map((m) => ({
        mallId: m.mallId,
        status: m.config.status,
        connectedAt: m.config.connectedAt ?? null,
        scopes: m.config.scopes ?? [],
        error: m.error,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
