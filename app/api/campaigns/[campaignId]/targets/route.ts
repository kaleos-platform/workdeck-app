import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/targets — 설정 이력 전체 조회
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  const targets = await prisma.campaignTarget.findMany({
    where: { workspaceId: workspace.id, campaignId },
    orderBy: { effectiveDate: 'desc' },
  })

  // KST 날짜 문자열로 복원 (저장 시 T00:00:00+09:00 → UTC 전날로 시프트되므로 +1일 보정)
  const toKSTDateStr = (date: Date) =>
    new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const result = targets.map((t) => ({
    ...t,
    effectiveDate: toKSTDateStr(t.effectiveDate),
  }))

  return NextResponse.json(result)
}

// POST /api/campaigns/[campaignId]/targets — 새 설정 등록 (upsert)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const body = await request.json()
  const { effectiveDate, dailyBudget, targetRoas } = body as {
    effectiveDate: string
    dailyBudget: number | null
    targetRoas: number | null
  }

  if (!effectiveDate) {
    return NextResponse.json({ error: '적용 시작일을 입력해주세요.' }, { status: 400 })
  }

  const effectiveDateObj = new Date(effectiveDate + 'T00:00:00+09:00')

  const target = await prisma.campaignTarget.upsert({
    where: {
      workspaceId_campaignId_effectiveDate: {
        workspaceId: workspace.id,
        campaignId,
        effectiveDate: effectiveDateObj,
      },
    },
    update: { dailyBudget: dailyBudget ?? null, targetRoas: targetRoas ?? null },
    create: {
      workspaceId: workspace.id,
      campaignId,
      effectiveDate: effectiveDateObj,
      dailyBudget: dailyBudget ?? null,
      targetRoas: targetRoas ?? null,
    },
  })

  const toKSTDateStr = (date: Date) =>
    new Date(date.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  return NextResponse.json({
    ...target,
    effectiveDate: toKSTDateStr(target.effectiveDate),
  })
}
