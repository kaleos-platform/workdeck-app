import { NextRequest, NextResponse } from 'next/server'
import { resolveWorkspace, errorResponse } from '@/lib/api-helpers'
import { createClient } from '@/lib/supabase/server'
import { processUpload } from '@/lib/upload-processor'
import { prisma } from '@/lib/prisma'

type UploadRequestBody = {
  storagePath: string
  fileName: string
}

export const runtime = 'nodejs'

function parseUploadBody(body: unknown): UploadRequestBody | null {
  if (typeof body !== 'object' || body === null) return null

  const storagePath =
    'storagePath' in body && typeof body.storagePath === 'string' ? body.storagePath.trim() : ''
  const fileName =
    'fileName' in body && typeof body.fileName === 'string' ? body.fileName.trim() : ''

  if (!storagePath || !fileName) return null
  return { storagePath, fileName }
}

function toStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null

  const asRecord = error as Record<string, unknown>
  const direct = asRecord.statusCode
  if (typeof direct === 'number') return direct

  const nested = asRecord.originalError
  if (typeof nested !== 'object' || nested === null) return null
  const nestedStatus = (nested as Record<string, unknown>).status
  return typeof nestedStatus === 'number' ? nestedStatus : null
}

async function downloadWithRetry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  maxRetry = 2
) {
  let lastError: unknown = null

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    const { data, error } = await supabase.storage.from('reports').download(storagePath)
    if (data) return { blob: data, error: null as unknown }

    lastError = error
    const statusCode = toStatusCode(error)
    const isRetryable = statusCode === null || statusCode >= 500
    if (!isRetryable || attempt === maxRetry) break

    const delayMs = 300 * (attempt + 1)
    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return { blob: null as Blob | null, error: lastError }
}

// POST /api/reports/upload — JSON body { storagePath, fileName }
// 브라우저가 Supabase Storage에 직접 업로드한 파일을 서버에서 다운로드 후 파싱·저장
export async function POST(request: NextRequest) {
  const resolved = await resolveWorkspace()
  if ('error' in resolved) return resolved.error
  const { workspace } = resolved

  // overwrite 쿼리 파라미터: null(첫 요청), 'true'(덮어쓰기), 'false'(중복 스킵)
  const url = new URL(request.url)
  const overwrite = url.searchParams.get('overwrite')

  // JSON body 파싱
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return errorResponse('요청 형식이 올바르지 않습니다. JSON 본문으로 요청해주세요', 415)
  }

  let parsedBody: UploadRequestBody | null = null
  try {
    const body = await request.json()
    parsedBody = parseUploadBody(body)
  } catch {
    return errorResponse('storagePath와 fileName이 필요합니다', 400)
  }
  if (!parsedBody) return errorResponse('storagePath와 fileName이 필요합니다', 400)
  const { storagePath, fileName } = parsedBody

  // Supabase Storage에서 파일 다운로드
  const supabase = await createClient()
  const { blob, error: downloadError } = await downloadWithRetry(supabase, storagePath, 2)

  if (downloadError || !blob) {
    console.error('Storage 파일 다운로드 오류:', downloadError)
    const statusCode = toStatusCode(downloadError)
    if (statusCode === null || statusCode >= 500) {
      return errorResponse('스토리지 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요', 503)
    }
    return errorResponse('파일 다운로드에 실패했습니다', 500)
  }

  // 파일 크기 제한: 10MB
  const MAX_SIZE = 10 * 1024 * 1024
  if (blob.size > MAX_SIZE) {
    await supabase.storage.from('reports').remove([storagePath])
    return errorResponse(
      '파일 크기가 10MB를 초과합니다. 파일을 분할하거나 용량을 줄인 후 다시 업로드해주세요',
      400
    )
  }

  // overwrite 파라미터를 boolean | null 로 변환
  const overwriteFlag = overwrite === 'true' ? true : overwrite === 'false' ? false : null

  try {
    const buffer = await blob.arrayBuffer()
    const result = await processUpload({
      workspaceId: workspace.id,
      fileName,
      buffer,
      overwrite: overwriteFlag,
    })

    // 파싱 에러
    if (!result.success && 'error' in result) {
      await supabase.storage.from('reports').remove([storagePath])
      return errorResponse(result.error, result.status, result.extra)
    }

    // 중복 감지 (Storage 파일은 유지 — 재요청 시 다시 다운로드)
    if (!result.success && 'requiresConfirmation' in result) {
      return NextResponse.json(
        {
          requiresConfirmation: true,
          duplicateCount: result.duplicateCount,
          newCount: result.newCount,
          totalCount: result.totalCount,
        },
        { status: 200 }
      )
    }

    // 처리 완료 후 Storage 임시 파일 삭제
    await supabase.storage.from('reports').remove([storagePath])

    // 수집 이력에 파일 업로드 기록 생성 (triggeredBy='file')
    await prisma.collectionRun.create({
      data: {
        workspaceId: workspace.id,
        triggeredBy: 'file',
        status: 'COMPLETED',
        startedAt: new Date(),
        completedAt: new Date(),
        uploadId: result.uploadId,
      },
    }).catch((err) => {
      console.error('CollectionRun(file) 생성 실패:', err)
    })

    return NextResponse.json(
      {
        uploadId: result.uploadId,
        inserted: result.inserted,
        skipped: result.skipped,
        totalRows: result.totalRows,
        insertedRows: result.insertedRows,
        duplicateRows: result.duplicateRows,
        errors: [],
      },
      { status: 201 }
    )
  } catch (err) {
    const detail =
      err instanceof Error
        ? {
            message: err.message,
            code: (err as unknown as Record<string, unknown>).code,
            meta: (err as unknown as Record<string, unknown>).meta,
          }
        : String(err)
    console.error('업로드 처리 중 오류:', JSON.stringify(detail, null, 2))

    const rawMessage = err instanceof Error ? err.message.toLowerCase() : ''
    if (
      rawMessage.includes('max client') ||
      rawMessage.includes('max clients') ||
      rawMessage.includes('max client connections')
    ) {
      return errorResponse(
        '데이터베이스 연결이 일시적으로 혼잡합니다. 잠시 후 다시 시도해주세요',
        503
      )
    }

    return errorResponse('데이터 저장 중 오류가 발생했습니다', 500)
  }
}
