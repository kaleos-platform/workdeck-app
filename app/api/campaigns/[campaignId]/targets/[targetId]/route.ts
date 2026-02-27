import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// PATCH /api/campaigns/[campaignId]/targets/[targetId] — 특정 이력 수정
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; targetId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { targetId } = await params
  const body = await request.json()
  const { dailyBudget, targetRoas, effectiveDate } = body as {
    dailyBudget?: number | null
    targetRoas?: number | null
    effectiveDate?: string
  }

  // 해당 레코드가 이 워크스페이스 소속인지 확인
  const existing = await prisma.campaignTarget.findUnique({ where: { id: targetId } })
  if (!existing || existing.workspaceId !== workspace.id) {
    return NextResponse.json({ error: '없거나 권한이 없습니다.' }, { status: 404 })
  }

  const updated = await prisma.campaignTarget.update({
    where: { id: targetId },
    data: {
      ...(dailyBudget !== undefined && { dailyBudget }),
      ...(targetRoas !== undefined && { targetRoas }),
      ...(effectiveDate !== undefined && {
        effectiveDate: new Date(effectiveDate + 'T00:00:00+09:00'),
      }),
    },
  })

  const toKSTDateStr = (date: Date) =>
    new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  return NextResponse.json({
    ...updated,
    effectiveDate: toKSTDateStr(updated.effectiveDate),
  })
}

// DELETE /api/campaigns/[campaignId]/targets/[targetId] — 특정 이력 삭제
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; targetId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { targetId } = await params

  const existing = await prisma.campaignTarget.findUnique({ where: { id: targetId } })
  if (!existing || existing.workspaceId !== workspace.id) {
    return NextResponse.json({ error: '없거나 권한이 없습니다.' }, { status: 404 })
  }

  await prisma.campaignTarget.delete({ where: { id: targetId } })
  return NextResponse.json({ ok: true })
}
