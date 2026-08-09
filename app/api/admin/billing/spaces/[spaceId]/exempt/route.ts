import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const exemptSchema = z.object({
  exempt: z.boolean(),
  note: z.string().trim().max(500).optional(),
})

// POST /api/admin/billing/spaces/[spaceId]/exempt — 면제 설정/해제
// scripts/billing-admin.mjs exempt/unexempt 명령을 그대로 이식.
// exempt=true: upsert(없으면 TRIALING 상태로 생성) — CLI와 동일 동작.
// exempt=false: 레코드 없으면 면제할 대상 자체가 없으므로 404(CLI unexempt는 UPDATE rowCount=0이면 무동작이지만,
//   웹에서는 존재하지 않는 구독의 해제 시도를 명확한 에러로 알리는 편이 안전).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { spaceId } = await params

  const space = await prisma.space.findUnique({ where: { id: spaceId }, select: { id: true } })
  if (!space) return errorResponse('Space를 찾을 수 없습니다', 404)

  const parsed = exemptSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청입니다', 400)
  const { exempt, note } = parsed.data

  const before = await prisma.spaceSubscription.findUnique({
    where: { spaceId },
    select: { exemptFlag: true, exemptNote: true },
  })

  if (!exempt && !before) {
    return errorResponse('면제 대상 구독이 존재하지 않습니다', 404)
  }

  const resolvedNote = exempt ? (note ?? '운영자 수동 면제') : (before?.exemptNote ?? null)

  const subscription = exempt
    ? await prisma.spaceSubscription.upsert({
        where: { spaceId },
        create: {
          spaceId,
          status: 'TRIALING',
          exemptFlag: true,
          exemptNote: resolvedNote,
        },
        update: { exemptFlag: true, exemptNote: resolvedNote },
      })
    : await prisma.spaceSubscription.update({
        where: { spaceId },
        data: { exemptFlag: false },
      })

  await writeAuditLog(auth.user.id, exempt ? 'billing.exempt' : 'billing.unexempt', 'space', spaceId, {
    before,
    after: { exemptFlag: subscription.exemptFlag, exemptNote: subscription.exemptNote },
    note,
  })

  return NextResponse.json({ subscription })
}
