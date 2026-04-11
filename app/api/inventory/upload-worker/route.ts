import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { processInventoryUpload } from '@/lib/inventory-upload-processor'

// POST /api/inventory/upload-worker — 워커가 수집한 재고 Excel 파일 업로드
export async function POST(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const workspaceId = formData.get('workspaceId') as string | null

    if (!file || !workspaceId) {
      return errorResponse('file과 workspaceId가 필요합니다', 400)
    }

    const buffer = await file.arrayBuffer()

    if (buffer.byteLength > 10 * 1024 * 1024) {
      return errorResponse('파일 크기가 10MB를 초과합니다', 400)
    }

    const result = await processInventoryUpload({
      workspaceId,
      fileName: file.name,
      buffer,
      snapshotDate: new Date(),
    })

    if (!result.success) {
      return errorResponse(result.error, 400)
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '업로드 처리 중 오류'
    return errorResponse(message, 500)
  }
}
