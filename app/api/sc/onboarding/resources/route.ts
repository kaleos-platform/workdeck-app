import { NextRequest, NextResponse } from 'next/server'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import {
  MAX_COLLECTION_RESOURCES,
  normalizeResourceUrl,
  resourceSelect,
} from '@/lib/sc/onboarding/crawl'
import { addUrlResourceSchema } from '@/lib/sc/onboarding/schemas'
import {
  extractTextFromFile,
  isExtractableMime,
  resourceMimeType,
  EXTRACT_TRUNCATION_MARKER,
} from '@/lib/sc/onboarding/extract'
import {
  uploadOnboardingFile,
  ALLOWED_RESOURCE_MIME,
  MAX_RESOURCE_FILE_BYTES,
} from '@/lib/sc/onboarding/storage'

export const maxDuration = 60

const MAX_RESOURCES = MAX_COLLECTION_RESOURCES

export async function GET() {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error

  const resources = await prisma.scOnboardingResource.findMany({
    where: { spaceId: resolved.space.id },
    orderBy: { createdAt: 'asc' },
    select: resourceSelect,
  })

  return NextResponse.json({ resources })
}

export async function POST(req: NextRequest) {
  const resolved = await resolveDeckContext('sales-content')
  if ('error' in resolved) return resolved.error
  const spaceId = resolved.space.id

  const contentType = req.headers.get('content-type') ?? ''

  // ── multipart: 파일 업로드 ──
  if (contentType.includes('multipart/form-data')) {
    const count = await prisma.scOnboardingResource.count({ where: { spaceId } })
    if (count >= MAX_RESOURCES)
      return errorResponse(`리소스는 최대 ${MAX_RESOURCES}개까지 등록할 수 있습니다`, 400)
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      return errorResponse('잘못된 요청 형식입니다', 400)
    }
    const file = form.get('file')
    if (!(file instanceof File)) return errorResponse('file 필드가 필요합니다', 400)
    const mimeType = resourceMimeType(file.type, file.name)
    if (!ALLOWED_RESOURCE_MIME.has(mimeType)) {
      return errorResponse('허용되지 않는 파일 형식입니다 (PDF·문서 파일만 가능)', 400)
    }
    if (file.size > MAX_RESOURCE_FILE_BYTES) {
      return errorResponse('파일이 용량 제한(10MB)을 초과했습니다', 400)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    let storagePath: string
    try {
      const uploaded = await uploadOnboardingFile({ spaceId, data: bytes, mimeType })
      storagePath = uploaded.path
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : '파일 업로드에 실패했습니다', 500)
    }

    // 텍스트 추출 — 실패해도 파일은 보관 (FAILED 상태로 표시)
    let extractedText: string | null = null
    let status: 'DONE' | 'FAILED' = 'DONE'
    let errorMessage: string | null = null
    if (isExtractableMime(mimeType)) {
      try {
        extractedText = await extractTextFromFile(bytes, mimeType)
        if (extractedText?.endsWith(EXTRACT_TRUNCATION_MARKER))
          errorMessage =
            '문서가 길어 앞 20,000자만 분석합니다. 이후 내용은 별도 자료로 나누어 추가해 주세요.'
        if (!extractedText) {
          status = 'FAILED'
          errorMessage = '텍스트를 추출하지 못했습니다 (스캔 이미지형 PDF일 수 있습니다)'
        }
      } catch (err) {
        status = 'FAILED'
        errorMessage = `텍스트 추출 실패: ${err instanceof Error ? err.message : String(err)}`
      }
    } else {
      status = 'FAILED'
      errorMessage = '이 형식은 텍스트 추출을 지원하지 않아 파일만 보관합니다'
    }

    const resource = await prisma.scOnboardingResource.create({
      data: {
        spaceId,
        kind: 'FILE',
        storagePath,
        fileName: file.name.slice(0, 300),
        mimeType,
        extractedText: extractedText
          ? JSON.stringify({
              version: 1,
              kind: 'document',
              title: file.name,
              text: extractedText,
              imageUrls: [],
            })
          : null,
        status,
        errorMessage,
      },
      select: resourceSelect,
    })
    return NextResponse.json({ resource }, { status: 201 })
  }

  // ── JSON: URL 등록 — 실제 수집은 collect에서 한 건씩 재개한다. ──
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }
  const parsed = addUrlResourceSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('올바른 URL을 입력하세요', 400, { issues: parsed.error.flatten() })
  }

  try {
    const sourceUrl = normalizeResourceUrl(parsed.data.url)
    const resource = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${spaceId}))`
      const existing = await tx.scOnboardingResource.findFirst({
        where: { spaceId, sourceUrl },
        select: resourceSelect,
      })
      if (existing?.status === 'FAILED')
        return tx.scOnboardingResource.update({
          where: { id: existing.id },
          data: { status: 'PENDING', errorMessage: null },
          select: resourceSelect,
        })
      if (existing) return existing
      if ((await tx.scOnboardingResource.count({ where: { spaceId } })) >= MAX_RESOURCES)
        throw new Error(`수집 안전 한도 ${MAX_RESOURCES}건에 도달했습니다`)
      return tx.scOnboardingResource.create({
        data: { spaceId, kind: 'URL', sourceUrl, status: 'PENDING' },
        select: resourceSelect,
      })
    })
    return NextResponse.json({ resource }, { status: 201 })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'URL 등록에 실패했습니다', 400)
  }
}
