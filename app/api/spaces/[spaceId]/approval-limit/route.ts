/**
 * PUT — 승인 한도(원). 이 금액을 넘는 지출 제안은 OWNER만 승인한다. null = 한도 없음(= 0원, 지출 제안은 모두 OWNER).
 * OWNER 전용이고 MCP 도구는 두지 않는다(승인 정책을 에이전트가 바꾸지 못하게 한다).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { errorResponse } from '@/lib/api-helpers'
import { requireSpaceOwner } from '@/lib/agent/identity/space-admin'

type Ctx = { params: Promise<{ spaceId: string }> }
const bodySchema = z.object({
  approvalLimitKrw: z.number().int().min(0).max(1_000_000_000).nullable(),
})

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { spaceId } = await params
  const auth = await requireSpaceOwner(spaceId)
  if ('error' in auth) return auth.error
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return errorResponse('입력값이 올바르지 않습니다', 400)
  const space = await prisma.space.update({
    where: { id: spaceId },
    data: { approvalLimitKrw: parsed.data.approvalLimitKrw },
    select: { id: true, approvalLimitKrw: true },
  })
  return NextResponse.json(space, { headers: { 'Cache-Control': 'no-store' } })
}
