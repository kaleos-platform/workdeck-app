import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/keyword-status
// 캠페인의 제거 처리된 키워드 목록 반환
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  const statuses = await prisma.keywordStatus.findMany({
    where: { workspaceId: workspace.id, campaignId },
    select: { keyword: true, removedAt: true, removedMemo: true },
  })

  return NextResponse.json({ items: statuses })
}

// POST /api/campaigns/[campaignId]/keyword-status
// body: { keywords: string[], removedMemo?: string }
// 키워드를 제거 상태로 upsert
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  let body: { keywords?: unknown; removedMemo?: unknown }
  try {
    body = await request.json()
  } catch {
    return errorResponse('요청 형식이 올바르지 않습니다', 400)
  }

  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return errorResponse('keywords 배열이 필요합니다', 400)
  }

  const keywords = body.keywords.filter((k): k is string => typeof k === 'string')
  const removedMemo = typeof body.removedMemo === 'string' ? body.removedMemo : null
  const removedAt = new Date()

  await Promise.all(
    keywords.map((keyword) =>
      prisma.keywordStatus.upsert({
        where: {
          workspaceId_campaignId_keyword: { workspaceId: workspace.id, campaignId, keyword },
        },
        create: { workspaceId: workspace.id, campaignId, keyword, removedAt, removedMemo },
        update: { removedAt, removedMemo },
      })
    )
  )

  return NextResponse.json({ success: true, count: keywords.length })
}

// DELETE /api/campaigns/[campaignId]/keyword-status?keywords=kw1,kw2
// 키워드 제거 상태 해제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const { searchParams } = request.nextUrl

  const keywordsParam = searchParams.get('keywords')
  if (!keywordsParam) {
    return errorResponse('keywords 파라미터가 필요합니다', 400)
  }

  const keywords = keywordsParam
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (keywords.length === 0) {
    return errorResponse('유효한 키워드가 없습니다', 400)
  }

  const result = await prisma.keywordStatus.deleteMany({
    where: { workspaceId: workspace.id, campaignId, keyword: { in: keywords } },
  })

  return NextResponse.json({ success: true, count: result.count })
}
