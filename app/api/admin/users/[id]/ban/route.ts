import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient } from '@/lib/supabase/admin'
import { banUserSchema } from '@/lib/validations/admin-users'

// POST /api/admin/users/[id]/ban — { ban: boolean }
// ban=true: 87600h(약 10년) 정지 (신규 로그인·리프레시만 차단, 기존 access token은 만료 전까지 유효)
// ban=false: 정지 해제
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, platformRole: true },
  })
  if (!target) return errorResponse('사용자를 찾을 수 없습니다', 404)

  if (id === auth.user.id) {
    return errorResponse('본인 계정은 어드민에서 정지할 수 없습니다', 400)
  }
  if (target.platformRole === 'OPERATOR') {
    return errorResponse(
      '운영자 계정은 어드민에서 변경할 수 없습니다. scripts/grant-operator.mjs로 권한을 회수한 뒤 처리하세요.',
      400
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = banUserSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 422, { issues: parsed.error.issues })
  }
  const { ban } = parsed.data

  const supabaseAdmin = getSupabaseAdminClient()
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(id, {
    ban_duration: ban ? '87600h' : 'none',
  })
  if (updateError) {
    return errorResponse('Supabase Auth 상태 변경에 실패했습니다', 502, {
      authError: updateError.message,
    })
  }

  // 주의: Supabase Admin API에는 "userId로 기존 세션 즉시 무효화"가 없다
  // (auth.admin.signOut()은 JWT 인자를 요구 — 로그인 중인 본인 세션 종료용).
  // ban_duration은 신규 로그인/리프레시만 차단하고, 이미 발급된 access token은
  // exp 만료(공식 문서 기준) 전까지 유효하다. 즉시 무효화가 필요하면 계정 삭제(DELETE)만 가능.
  await writeAuditLog(auth.user.id, ban ? 'user.ban' : 'user.unban', 'user', id, {
    email: target.email,
  })

  return NextResponse.json({ ok: true, ban })
}
