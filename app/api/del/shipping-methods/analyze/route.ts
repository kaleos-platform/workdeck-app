import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { previewFile } from '@/lib/del/channel-import-parser'
import { analyzeFormat } from '@/lib/del/format-analyzer'

const MAX_SIZE = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const formData = await req.formData().catch(() => null)
  if (!formData) return errorResponse('FormData가 필요합니다', 400)

  const file = formData.get('file') as File | null
  if (!file) return errorResponse('파일이 필요합니다', 400)

  if (file.size > MAX_SIZE) {
    return errorResponse('파일이 너무 큽니다 (최대 10MB)', 400)
  }

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'xlsx' && ext !== 'xls') {
    return errorResponse('xlsx, xls 파일만 지원합니다', 400)
  }

  const rawSheetName = formData.get('sheetName')
  const sheetName = typeof rawSheetName === 'string' ? rawSheetName : undefined

  const buffer = await file.arrayBuffer()

  try {
    const preview = previewFile(buffer, sheetName)
    if (preview.headers.length === 0) {
      return NextResponse.json({ ...preview, suggestedColumns: [] })
    }
    const suggestedColumns = analyzeFormat(preview.headers, preview.sampleRows)
    return NextResponse.json({ ...preview, suggestedColumns })
  } catch {
    return errorResponse('양식 파일을 읽을 수 없습니다. 올바른 Excel 파일인지 확인해 주세요', 400)
  }
}
