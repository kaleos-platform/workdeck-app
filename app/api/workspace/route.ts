import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/hooks/use-user'
import { errorResponse } from '@/lib/api-helpers'
import { SignupNotAllowedError } from '@/lib/marketing/lead-signup'
import { ensureWorkspaceForUser } from '@/lib/workspace'

// POST /api/workspace — 워크스페이스 생성 (1인 1워크스페이스)
export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return errorResponse('인증이 필요합니다', 401)

  const body = await request.json().catch(() => null)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return errorResponse('워크스페이스 이름을 입력해주세요', 400)

  try {
    const { workspace, created } = await ensureWorkspaceForUser(
      {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.name ?? null,
        signupSource: user.user_metadata?.signup_source,
      },
      name
    )

    return NextResponse.json(workspace, { status: created ? 201 : 200 })
  } catch (error) {
    if (error instanceof SignupNotAllowedError)
      return errorResponse(error.message, 403, { code: 'SIGNUP_REQUIRES_LEAD' })
    throw error
  }
}
