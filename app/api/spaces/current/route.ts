import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUser } from '@/hooks/use-user'
import { errorResponse } from '@/lib/api-helpers'
import {
  CURRENT_SPACE_COOKIE,
  CURRENT_SPACE_COOKIE_OPTIONS,
  listMemberships,
  resolveCurrentMembership,
} from '@/lib/spaces/current-space'

// GET·POST /api/spaces/current — 사이드바 Space 전환 메뉴(현재 Space·목록, 전환 쿠키).
export async function GET() {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  const [current, all] = await Promise.all([
    resolveCurrentMembership(user.id),
    listMemberships(user.id),
  ])
  const cur = current && !('forbidden' in current) ? current : null
  return NextResponse.json({
    current: cur ? { id: cur.space.id, name: cur.space.name, role: cur.role } : null,
    spaces: all.map((m) => ({ id: m.space.id, name: m.space.name, role: m.role })),
  })
}

const bodySchema = z.object({ spaceId: z.string().min(1).max(64) })

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('Space를 확인하세요', 422)
  const all = await listMemberships(user.id)
  if (!all.some((m) => m.space.id === parsed.data.spaceId))
    return errorResponse('Space를 찾을 수 없습니다', 404)
  const res = new NextResponse(null, { status: 204 })
  res.cookies.set(CURRENT_SPACE_COOKIE, parsed.data.spaceId, CURRENT_SPACE_COOKIE_OPTIONS)
  return res
}
