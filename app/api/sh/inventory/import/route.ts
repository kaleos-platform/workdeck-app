// 재고 이동 대량 가져오기 API
// POST: 업로드된 Excel/CSV 파일을 파싱하고 배치 처리 후 결과 반환
// GET: 해당 공간의 가져오기 이력 목록 (페이지네이션)

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { parseImportFile, ImportColumnError } from '@/lib/inv/import-parser'
import { processImport } from '@/lib/inv/import-processor'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return errorResponse('multipart/form-data가 유효하지 않습니다', 400)
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return errorResponse('file 필드가 필요합니다', 400)
  }
  const fileName = file.name || 'upload.xlsx'
  if (!/\.(xlsx|csv)$/i.test(fileName)) {
    return errorResponse('xlsx 또는 csv 파일만 지원합니다', 400)
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    return errorResponse('파일을 읽을 수 없습니다', 400)
  }

  try {
    const { rows, parseErrors } = parseImportFile(buffer, fileName)
    const result = await processImport(resolved.space.id, fileName, rows, parseErrors)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    if (err instanceof ImportColumnError) {
      return errorResponse(err.message, 400, {
        missingColumns: err.missingColumns,
        foundColumns: err.foundColumns,
      })
    }
    console.error('[POST /api/inv/import] 실패', err)
    return errorResponse('가져오기 처리에 실패했습니다', 500)
  }
}

export async function GET(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20)))

  const where = { spaceId: resolved.space.id }

  const [data, total] = await Promise.all([
    prisma.invImportHistory.findMany({
      where,
      orderBy: { importedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invImportHistory.count({ where }),
  ])

  return NextResponse.json({ data, total, page, pageSize })
}
