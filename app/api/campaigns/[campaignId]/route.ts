import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// PATCH /api/campaigns/[campaignId] — 캠페인 표시명 커스텀 변경
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  let body: { displayName?: string }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 본문을 파싱할 수 없습니다', 400)
  }

  const { displayName } = body
  if (!displayName || typeof displayName !== 'string' || displayName.trim() === '') {
    return errorResponse('displayName이 필요합니다', 400)
  }

  // 해당 캠페인이 워크스페이스에 존재하는지 확인
  const recordExists = await prisma.adRecord.findFirst({
    where: { workspaceId: workspace.id, campaignId },
    select: { id: true, campaignName: true },
  })
  if (!recordExists) {
    return errorResponse('캠페인을 찾을 수 없습니다', 404)
  }

  // CampaignMeta upsert — isCustomName: true로 설정
  const meta = await prisma.campaignMeta.upsert({
    where: { workspaceId_campaignId: { workspaceId: workspace.id, campaignId } },
    create: {
      workspaceId: workspace.id,
      campaignId,
      displayName: displayName.trim(),
      isCustomName: true,
    },
    update: {
      displayName: displayName.trim(),
      isCustomName: true,
    },
  })

  return NextResponse.json({
    campaignId: meta.campaignId,
    displayName: meta.displayName,
    isCustomName: meta.isCustomName,
  })
}

// DELETE /api/campaigns/[campaignId] — 캠페인 삭제
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  const exists = await prisma.adRecord.findFirst({
    where: { workspaceId: workspace.id, campaignId },
    select: { id: true },
  })
  if (!exists) {
    return errorResponse('캠페인을 찾을 수 없습니다', 404)
  }

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const adRecordResult = await tx.adRecord.deleteMany({
        where: { workspaceId: workspace.id, campaignId },
      })
      const dailyMemoResult = await tx.dailyMemo.deleteMany({
        where: { workspaceId: workspace.id, campaignId },
      })
      const campaignMetaResult = await tx.campaignMeta.deleteMany({
        where: { workspaceId: workspace.id, campaignId },
      })

      return {
        adRecords: adRecordResult.count,
        dailyMemos: dailyMemoResult.count,
        campaignMetas: campaignMetaResult.count,
      }
    })

    return NextResponse.json({
      message: '캠페인이 삭제되었습니다. 삭제된 데이터는 복구할 수 없습니다.',
      deleted,
    })
  } catch {
    return errorResponse('캠페인 삭제 중 오류가 발생했습니다', 500)
  }
}
