import { NextResponse } from 'next/server'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { mfaRequiredSchema } from '@/lib/validations/admin-users'

// POST /api/admin/users/[id]/mfa-required — { mfaRequired: boolean }
// 일반 사용자의 2단계 인증 필수 여부. 운영자는 게이트에서 항상 필수라 변경하지 않는다.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, platformRole: true },
  })
  if (!target) return errorResponse('사용자를 찾을 수 없습니다', 404)

  if (target.platformRole === 'OPERATOR') {
    return errorResponse('운영자 계정은 항상 2단계 인증이 필요합니다', 400)
  }

  const body = await request.json().catch(() => null)
  const parsed = mfaRequiredSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('요청 본문이 올바르지 않습니다', 422, { issues: parsed.error.issues })
  }
  const { mfaRequired } = parsed.data

  // 감사 기록이 실패하면 변경도 함께 롤백한다.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { mfaRequired } })
    await writeAuditLog(
      auth.user.id,
      mfaRequired ? 'user.mfa_required.on' : 'user.mfa_required.off',
      'user',
      id,
      { email: target.email },
      tx
    )
  })

  return NextResponse.json({ ok: true, mfaRequired })
}
