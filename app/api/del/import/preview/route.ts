import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { previewFile } from '@/lib/del/channel-import-parser'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('delivery-mgmt')
  if ('error' in resolved) return resolved.error

  const formData = await req.formData().catch(() => null)
  if (!formData) return errorResponse('FormData가 필요합니다', 400)

  const file = formData.get('file') as File | null
  if (!file) return errorResponse('파일이 필요합니다', 400)

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
    return errorResponse('xlsx, xls, csv 파일만 지원합니다', 400)
  }

  const buffer = await file.arrayBuffer()
  const preview = previewFile(buffer)

  return NextResponse.json(preview)
}
