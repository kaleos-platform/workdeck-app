import { NextResponse } from 'next/server'
import { requireOperator } from '@/lib/admin/auth'
import { SubscriptionAdminError, updateSubscriptionAccess } from '@/lib/billing/subscription-admin'
import { adminSubscriptionPatchSchema } from '@/lib/validations/admin-subscriptions'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; deckAppId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response
  const parsed = adminSubscriptionPatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      { message: '날짜·면제 여부와 변경 사유를 확인해 주세요' },
      { status: 400 }
    )
  const { spaceId, deckAppId } = await params
  if (!spaceId || !deckAppId)
    return NextResponse.json({ message: '대상 업무를 찾을 수 없습니다' }, { status: 404 })
  try {
    return NextResponse.json({
      policy: await updateSubscriptionAccess(auth.user.id, spaceId, deckAppId, parsed.data),
    })
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof SubscriptionAdminError
            ? error.message
            : '이용 정책을 변경하지 못했습니다',
      },
      { status: error instanceof SubscriptionAdminError ? error.status : 500 }
    )
  }
}
