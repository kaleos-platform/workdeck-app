import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { previewFile } from '@/lib/del/channel-import-parser'
import { decryptXlsxBuffer, isEncryptedXlsx, WrongPasswordError } from '@/lib/sh/xlsx-encryption'

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const formData = await req.formData().catch(() => null)
  if (!formData) return errorResponse('FormData가 필요합니다', 400)

  const file = formData.get('file') as File | null
  if (!file) return errorResponse('파일이 필요합니다', 400)

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
    return errorResponse('xlsx, xls, csv 파일만 지원합니다', 400)
  }

  let buffer = await file.arrayBuffer()
  const password = (formData.get('password') as string | null) ?? ''

  if (isEncryptedXlsx(buffer)) {
    if (!password) {
      return NextResponse.json(
        { error: '비밀번호로 보호된 파일입니다', code: 'ENCRYPTED_FILE_PASSWORD_REQUIRED' },
        { status: 422 }
      )
    }
    try {
      buffer = await decryptXlsxBuffer(buffer, password)
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        return NextResponse.json(
          { error: '비밀번호가 올바르지 않습니다', code: 'WRONG_PASSWORD' },
          { status: 422 }
        )
      }
      return errorResponse('암호화된 파일을 복호화하지 못했습니다', 400)
    }
  }

  try {
    const preview = previewFile(buffer)
    return NextResponse.json(preview)
  } catch {
    return errorResponse('파일을 읽을 수 없습니다. 올바른 Excel/CSV 파일인지 확인해 주세요', 400)
  }
}
