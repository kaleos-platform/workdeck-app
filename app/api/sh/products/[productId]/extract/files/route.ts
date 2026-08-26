// POST: multipart/form-data 로 상품 정보 추출용 소재 파일(이미지/PDF)을 업로드한다.
// 클라이언트가 보내는 MIME/크기는 신뢰하지 않고 서버에서 다시 검증한다.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  ALLOWED_SOURCE_MIME_TYPES,
  MAX_SOURCE_FILE_BYTES,
  ProductSourceUploadError,
  uploadProductSourceFile,
} from '@/lib/sh/product-source-storage'

export const runtime = 'nodejs'
export const maxDuration = 30

type Params = { params: Promise<{ productId: string }> }

function isAllowedMime(mime: string): mime is (typeof ALLOWED_SOURCE_MIME_TYPES)[number] {
  return (ALLOWED_SOURCE_MIME_TYPES as readonly string[]).includes(mime)
}

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    return errorResponse('multipart/form-data 요청이어야 합니다', 400)
  }

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return errorResponse('file 필드가 필요합니다', 400)

  // 클라이언트가 보낸 file.type 은 신뢰할 수 없으므로 화이트리스트로 재검증.
  if (!isAllowedMime(file.type)) {
    return errorResponse('허용되지 않는 파일 형식입니다', 400)
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    return errorResponse('파일이 용량 제한(10MB)을 초과했습니다', 413)
  }

  const bytes = Buffer.from(await file.arrayBuffer())

  try {
    const uploaded = await uploadProductSourceFile({
      spaceId: resolved.space.id,
      productId,
      fileName: file.name,
      mimeType: file.type,
      bytes,
    })
    const kind = uploaded.mimeType === 'application/pdf' ? 'PDF' : 'IMAGE'
    return NextResponse.json(
      {
        storagePath: uploaded.storagePath,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        byteSize: uploaded.byteSize,
        kind,
      },
      { status: 201 }
    )
  } catch (err) {
    if (err instanceof ProductSourceUploadError) {
      const status = err.code === 'TOO_LARGE' ? 413 : err.code === 'MIME_NOT_ALLOWED' ? 400 : 500
      return errorResponse(err.message, status, { code: err.code })
    }
    const detail = err instanceof Error ? err.message : String(err)
    console.error('[extract/files] 업로드 실패', { productId, detail })
    return errorResponse('업로드에 실패했습니다', 500, { detail })
  }
}
