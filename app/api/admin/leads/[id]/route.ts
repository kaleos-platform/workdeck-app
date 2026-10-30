import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireOperator, writeAuditLog } from '@/lib/admin/auth'
import { errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

const patchSchema = z
  .object({
    status: z.enum(['NEW', 'CONTACTED', 'CONVERTED', 'DROPPED']).optional(),
    memo: z.string().max(2000).optional(),
  })
  .refine((v) => v.status !== undefined || v.memo !== undefined, {
    message: 'status 또는 memo 중 하나는 필요합니다',
  })

// PATCH /api/admin/leads/[id] — 도입 신청 상태·메모 변경
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperator()
  if (!auth.ok) return auth.response

  const { id } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return errorResponse('잘못된 요청입니다', 400)

  const exists = await prisma.marketingLead.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return errorResponse('도입 신청을 찾을 수 없습니다', 404)

  const lead = await prisma.marketingLead.update({
    where: { id },
    data: { status: parsed.data.status, memo: parsed.data.memo },
    select: { id: true, status: true, memo: true },
  })
  await writeAuditLog(auth.user.id, 'marketingLead.update', 'marketingLead', id, parsed.data)

  return NextResponse.json({ lead })
}
