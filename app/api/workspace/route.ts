import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse } from '@/lib/api-helpers'
import { ensureWorkspaceForUser } from '@/lib/workspace'

// POST /api/workspace — 워크스페이스 생성 (1인 1워크스페이스)
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return errorResponse('워크스페이스 이름을 입력해주세요', 400)

  const { workspace, created } = await ensureWorkspaceForUser(
    { id: user.id, email: user.email, name: user.user_metadata?.name ?? null },
    name
  )

  return NextResponse.json(workspace, { status: created ? 201 : 200 })
}
