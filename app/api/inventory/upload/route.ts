import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { createClient } from '@/lib/supabase/server'
import { processInventoryUpload } from '@/lib/inventory-upload-processor'
import { runAndSaveInventoryAnalysis } from '@/lib/inventory-analyzer'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error

  const body = await req.json().catch(() => null)
  if (!body?.storagePath || !body?.fileName) {
    return errorResponse('storagePath와 fileName이 필요합니다', 400)
  }

  const snapshotDate = body.snapshotDate ? new Date(body.snapshotDate) : new Date()
  if (isNaN(snapshotDate.getTime())) {
    return errorResponse('유효하지 않은 날짜 형식입니다', 400)
  }

  // Supabase Storage에서 다운로드
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from('reports').download(body.storagePath)
  if (error || !data) {
    return errorResponse('파일 다운로드 실패', 500)
  }

  const buffer = await data.arrayBuffer()

  // 서버 사이드 파일 크기 제한 (10MB)
  if (buffer.byteLength > 10 * 1024 * 1024) {
    return errorResponse('파일 크기가 10MB를 초과합니다', 400)
  }

  const result = await processInventoryUpload({
    workspaceId: resolved.workspace.id,
    fileName: body.fileName,
    buffer,
    snapshotDate,
  })

  // 임시 파일 삭제
  await supabase.storage.from('reports').remove([body.storagePath]).catch(() => {})

  if (!result.success) {
    return errorResponse(result.error, 400)
  }

  // 업로드 성공 → 재고 분석 자동 실행 (fire-and-forget)
  runAndSaveInventoryAnalysis({
    workspaceId: resolved.workspace.id,
    triggeredBy: 'manual',
    sendSlack: true,
  }).catch((err) => console.error('[inventory-upload] 분석 실행 실패:', err))

  return NextResponse.json(result)
}
