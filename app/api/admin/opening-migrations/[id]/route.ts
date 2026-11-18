import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { decryptField } from '@/lib/crypto/field-crypto'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

export const runtime = 'nodejs'

const bodySchema = z
  .object({
    action: z.enum(['approve', 'hold', 'complete']),
    updatedAt: z.string().datetime().optional(),
  })
  .strict()

// POST /api/admin/opening-migrations/[id] — 승인(PLANNED→APPROVED) / 수동 적용 완료(APPROVED→DONE)
// / 보류(MATCHED·PLANNED·BLOCKED·FAILED·APPROVED→HELD). 1차에는 적용 처리기가 없어 APPROVED 를 운영자가 닫는다.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청입니다', 400)

  const job = await prisma.openingMigrationJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      summary: true,
      updatedAt: true,
      openingBrandId: true,
      contactHitsEnc: true,
      contactHitsIv: true,
    },
  })
  if (!job) return errorResponse('이전 job을 찾을 수 없습니다', 404)

  // 상태 전이는 조건부 update 로만 하고, 감사 로그와 같은 transaction 으로 묶는다.
  // 동시에 두 번 눌러도 한 번만 반영된다(count 로 판정).
  const action = parsed.data.action
  const snapshot = (job.summary as { snapshot?: Prisma.InputJsonValue } | null)?.snapshot
  if (action === 'approve' && (job.status !== 'PLANNED' || !snapshot))
    return errorResponse('승인할 수 없는 상태입니다', 409)
  // 연락처 조각을 운영자가 볼 수 없으면(복호화 실패) 검토 없이 승인되므로 막는다.
  // 승인 update 는 updatedAt 조건이라 여기서 확인한 조각이 그대로 확정된다.
  if (action === 'approve' && job.contactHitsEnc) {
    try {
      decryptField('pii', job.contactHitsEnc, job.contactHitsIv ?? '')
    } catch {
      return errorResponse('연락처 조각을 확인할 수 없어 승인할 수 없습니다', 409)
    }
  }
  // 낡은 화면에서 승인하지 않도록, 화면이 본 updatedAt 이 지금과 다르면 거절한다.
  if (
    parsed.data.updatedAt &&
    new Date(parsed.data.updatedAt).getTime() !== job.updatedAt.getTime()
  )
    return errorResponse('이미 처리되었거나 상태가 바뀌었습니다', 409)
  const applied = await prisma.$transaction(async (tx) => {
    const result =
      action === 'approve'
        ? // updatedAt 을 함께 걸어, 읽은 뒤 재계획으로 summary 가 바뀐 경우 낡은 snapshot 을 확정하지 않는다.
          await tx.openingMigrationJob.updateMany({
            where: { id, status: 'PLANNED', updatedAt: job.updatedAt },
            data: {
              status: 'APPROVED',
              approvedBy: auth.user.id,
              approvedAt: new Date(),
              approvedSnapshot: snapshot,
            },
          })
        : action === 'complete'
          ? await tx.openingMigrationJob.updateMany({
              where: { id, status: 'APPROVED' },
              data: { status: 'DONE', contactHitsEnc: null, contactHitsIv: null },
            })
          : await tx.openingMigrationJob.updateMany({
              where: {
                id,
                status: { in: ['MATCHED', 'PLANNED', 'BLOCKED', 'FAILED', 'APPROVED'] },
              },
              data: { status: 'HELD', contactHitsEnc: null, contactHitsIv: null },
            })
    if (result.count !== 1) return false
    await writeAuditLog(
      auth.user.id,
      `openingMigration.${action}`,
      'openingMigrationJob',
      id,
      { openingBrandId: job.openingBrandId },
      tx
    )
    return true
  })
  if (!applied) return errorResponse('이미 처리되었거나 상태가 바뀌었습니다', 409)
  return NextResponse.json({ ok: true })
}
