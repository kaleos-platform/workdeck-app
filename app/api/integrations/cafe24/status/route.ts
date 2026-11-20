/**
 * GET /api/integrations/cafe24/status?spaceId=…
 * 연결 카드용 상태(ADMIN 이상). 시크릿·토큰은 돌려주지 않는다(복호화하지 않고 config 와 오류 문구만 읽는다).
 */
import { NextRequest, NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { prisma } from '@/lib/prisma'
import type { Cafe24Config } from '@/lib/cafe24/store'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const spaceId = req.nextUrl.searchParams.get('spaceId')
  if (!spaceId) return errorResponse('잘못된 요청입니다', 400)
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error

  const row = await prisma.spaceCredential.findUnique({
    where: { spaceId_provider: { spaceId, provider: 'cafe24' } },
    select: { config: true, lastError: true, healthError: true },
  })
  const c = (row?.config ?? null) as Partial<Cafe24Config> | null
  return NextResponse.json(
    {
      configured: !!row,
      mallId: c?.mallId ?? null,
      status: c?.status ?? null,
      connectedAt: c?.connectedAt ?? null,
      scopes: c?.scopes ?? [],
      error: row?.healthError ?? row?.lastError ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
