import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkerAuth, errorResponse } from '@/lib/api-helpers'
import { processInventoryUpload, processInventoryApiRows } from '@/lib/inventory-upload-processor'
import type { InventoryApiRowInput } from '@/lib/inventory-upload-processor'
import type { ApiOptionIdentity } from '@/lib/collection/resolve-product-id'
import type { InventoryFileType } from '@/lib/inventory-parser'

// POST /api/inventory/upload-worker — 워커가 수집한 재고 데이터 업로드.
// multipart/form-data(기존 크롤링 Excel 경로, 절대 건드리지 않는다) / application/json
// (쿠팡 재고 API rows 경로, 신규) 두 갈래로 분기한다.
export async function POST(request: NextRequest) {
  const auth = resolveWorkerAuth(request)
  if ('error' in auth) return auth.error

  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return handleApiRowsUpload(request)
  }

  return handleFileUpload(request)
}

// 기존 경로 — 크롤링 Excel 업로드. 동작을 절대 바꾸지 않는다.
async function handleFileUpload(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const workspaceId = formData.get('workspaceId') as string | null
    // 워커가 수집 대상 날짜를 ISO 문자열로 전달하는 경우 사용. 없으면 현재 시각.
    const snapshotDateStr = formData.get('snapshotDate') as string | null

    if (!file || !workspaceId) {
      return errorResponse('file과 workspaceId가 필요합니다', 400)
    }

    const buffer = await file.arrayBuffer()

    if (buffer.byteLength > 10 * 1024 * 1024) {
      return errorResponse('파일 크기가 10MB를 초과합니다', 400)
    }

    const snapshotDate = snapshotDateStr ? new Date(snapshotDateStr) : new Date()

    const result = await processInventoryUpload({
      workspaceId,
      fileName: file.name,
      buffer,
      snapshotDate,
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

// 신규 경로 — 쿠팡 재고 API rows. 워커는 Prisma 의존이 없어 productId/productName/
// optionName 을 채우지 못하므로(worker/package.json 참조), 여기서 resolveOptionIdentity() 로 채운다.
type ApiRowsBody = {
  workspaceId?: string
  snapshotDate?: string
  fileType?: string
  source?: string
  rows?: InventoryApiRowInput[]
  apiProductMap?: Record<string, ApiOptionIdentity>
  truncated?: boolean
}

async function handleApiRowsUpload(request: NextRequest) {
  try {
    const body = (await request.json()) as ApiRowsBody
    const { workspaceId, fileType, rows, apiProductMap, truncated } = body

    if (!workspaceId || !fileType || !Array.isArray(rows)) {
      return errorResponse('workspaceId, fileType, rows가 필요합니다', 400)
    }
    if (body.source && body.source !== 'API') {
      return errorResponse('JSON 경로는 source=API 전용입니다', 400)
    }

    const snapshotDate = body.snapshotDate ? new Date(body.snapshotDate) : new Date()

    const result = await processInventoryApiRows({
      workspaceId,
      fileType: fileType as InventoryFileType,
      snapshotDate,
      rows,
      apiProductMap,
      truncated,
    })

    if (!result.success) {
      return errorResponse(result.error, 400)
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'API 재고 업로드 처리 중 오류'
    return errorResponse(message, 500)
  }
}
