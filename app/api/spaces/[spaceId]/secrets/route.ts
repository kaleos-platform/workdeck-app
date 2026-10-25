/**
 * GET — Space 비밀값 목록(ADMIN 이상). 이름·메타만 돌려주고 값·IV·암호문은 절대 싣지 않는다.
 */
import { NextResponse } from 'next/server'
import { requireSpaceAdmin } from '@/lib/agent/identity/space-admin'
import { listSecretMeta } from '@/lib/agent/secrets/store'

type Ctx = { params: Promise<{ spaceId: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  const { spaceId } = await params
  const auth = await requireSpaceAdmin(spaceId)
  if ('error' in auth) return auth.error
  return NextResponse.json(
    { secrets: await listSecretMeta(spaceId) },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
