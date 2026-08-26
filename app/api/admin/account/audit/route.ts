import { NextRequest } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'

// 화이트리스트 — 임의 action 문자열 주입(로그 오염) 방지
const ALLOWED_ACTIONS = new Set([
  'account.password.change',
  'account.mfa.enroll',
  'account.mfa.unenroll',
])

// POST /api/admin/account/audit — 클라이언트가 Supabase를 직접 호출하는 계정 설정 액션의 감사 로그.
// MFA 등록 도중(aal1) 호출될 수 있으므로, 다른 /api/admin/** 와 달리 MFA_REQUIRED도 통과시킨다.
export async function POST(request: NextRequest) {
  const auth = await requireOperator()
  if (!auth.ok && auth.reason === 'NOT_OPERATOR') return auth.response

  const body = await request.json().catch(() => null)
  const action = body?.action

  if (typeof action !== 'string' || !ALLOWED_ACTIONS.has(action)) {
    return errorResponse('허용되지 않은 action입니다', 400)
  }

  await writeAuditLog(auth.user.id, action, 'user', auth.user.id)

  return new Response(null, { status: 204 })
}
