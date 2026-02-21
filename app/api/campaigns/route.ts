import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace } from '@/lib/api-helpers'

// GET /api/campaigns — 워크스페이스 내 캠페인 목록
export async function GET() {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // 캠페인 ID별 distinct 조회
  const rows = await prisma.adRecord.findMany({
    where: { workspaceId: workspace.id },
    select: {
      campaignId: true,
      campaignName: true,
      adType: true,
    },
    distinct: ['campaignId', 'adType'],
    orderBy: { campaignId: 'asc' },
  })

  // campaignId별 그룹화
  const campaignMap = new Map<string, { id: string; name: string; adTypes: string[] }>()
  for (const row of rows) {
    if (!campaignMap.has(row.campaignId)) {
      campaignMap.set(row.campaignId, {
        id: row.campaignId,
        name: row.campaignName,
        adTypes: [],
      })
    }
    const campaign = campaignMap.get(row.campaignId)!
    if (!campaign.adTypes.includes(row.adType)) {
      campaign.adTypes.push(row.adType)
    }
  }

  const campaigns = Array.from(campaignMap.values())
  return NextResponse.json(campaigns)
}
