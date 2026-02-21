import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'

// GET /api/campaigns/[campaignId]/memos — 메모 목록 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  const memos = await prisma.dailyMemo.findMany({
    where: { workspaceId: workspace.id, campaignId },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      campaignId: true,
      date: true,
      content: true,
    },
  })

  // 날짜 → YYYY-MM-DD 포맷
  const items = memos.map((m: { id: string; campaignId: string; date: Date; content: string }) => ({
    ...m,
    date: m.date.toISOString().split('T')[0],
  }))

  return NextResponse.json({ items })
}

// POST /api/campaigns/[campaignId]/memos — 메모 생성/수정 (upsert)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params

  let body: { date?: string; content?: string }
  try {
    body = await request.json()
  } catch {
    return errorResponse('JSON 파싱에 실패했습니다', 400)
  }

  const { date, content } = body
  if (!date || typeof date !== 'string') {
    return errorResponse('날짜를 입력해주세요', 400)
  }
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return errorResponse('메모 내용을 입력해주세요', 400)
  }

  // Asia/Seoul 자정 기준 UTC 저장
  const dateUtc = new Date(date + 'T00:00:00+09:00')

  const memo = await prisma.dailyMemo.upsert({
    where: {
      workspaceId_campaignId_date: {
        workspaceId: workspace.id,
        campaignId,
        date: dateUtc,
      },
    },
    create: {
      workspaceId: workspace.id,
      campaignId,
      date: dateUtc,
      content: content.trim(),
    },
    update: {
      content: content.trim(),
    },
    select: {
      id: true,
      campaignId: true,
      date: true,
      content: true,
    },
  })

  return NextResponse.json({
    ...memo,
    date: memo.date.toISOString().split('T')[0],
  })
}

// DELETE /api/campaigns/[campaignId]/memos?date=YYYY-MM-DD — 메모 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  const { campaignId } = await params
  const date = request.nextUrl.searchParams.get('date')

  if (!date) {
    return errorResponse('삭제할 날짜를 입력해주세요', 400)
  }

  const dateUtc = new Date(date + 'T00:00:00+09:00')

  await prisma.dailyMemo.deleteMany({
    where: {
      workspaceId: workspace.id,
      campaignId,
      date: dateUtc,
    },
  })

  return NextResponse.json({ success: true })
}
