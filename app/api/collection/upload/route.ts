import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { processUpload } from '@/lib/upload-processor'
import { invalidateCoupangAdsCache } from '@/lib/coupang-ads/cache'

// POST /api/collection/upload — 워커가 수집한 Excel 파일 업로드
export async function POST(request: NextRequest) {
  // 워커 인증
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const workspaceId = formData.get('workspaceId') as string | null

    if (!file || !workspaceId) {
      return errorResponse('file과 workspaceId가 필요합니다', 400)
    }

    // arrayBuffer 로드 전 크기 검사 — OOM/타임아웃 방지
    const MAX_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.size > MAX_SIZE) {
      return errorResponse('파일이 너무 큽니다 (최대 10MB)', 400)
    }

    const buffer = await file.arrayBuffer()

    // 기존 upload-processor 재사용
    const result = await processUpload({
      workspaceId,
      fileName: file.name,
      buffer,
      overwrite: true, // 워커 수집은 항상 덮어쓰기
    })

    if (result.success) invalidateCoupangAdsCache(workspaceId)

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '업로드 처리 중 오류'
    return errorResponse(message, 500)
  }
}
