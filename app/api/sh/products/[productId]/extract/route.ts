// POST: URL 텍스트/직접 입력 텍스트/파일 소재를 모아 AI로 상품 정보를 추출하는 잡을 실행한다.
// GET : 최근 잡 10개 이력을 반환한다(디버그용 rawResponse는 제외 — extract/[jobId] 상세에서만 노출).

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { resolveDeckContext, errorResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { productExtractRequestSchema } from '@/lib/sh/schemas'
import {
  isOwnedSourcePath,
  MAX_JOB_INLINE_BYTES,
  downloadProductSourceFile,
  ProductSourceUploadError,
} from '@/lib/sh/product-source-storage'
import {
  EXTRACT_MODEL,
  ProductExtractError,
  extractProductInfo,
  type ExtractSourcePart,
} from '@/lib/sh/product-extract'
import { safeFetchBinary, SafeFetchError } from '@/lib/net/safe-fetch'
import {
  TextCreditExceededError,
  commitTextCredit,
  refundTextCredit,
  reserveTextCredit,
} from '@/lib/ai/credit'

// URL 소재 HTML에서 뽑아낸 상세 이미지 다운로드 결과 집계 — 사용자가 "이미지를 봤는지"
// 알 수 있게 job.result에 함께 남긴다(스키마 변경 없이 기존 Json 필드에 병기).
type ImageFetchStats = {
  requested: number
  succeeded: number
  failed: number
  /** 업로드 파일 + 이미지 합산이 12MB 상한(MAX_JOB_INLINE_BYTES)에 닿아 아예 받지 않은 개수 */
  skippedByteLimit: number
}

export const runtime = 'nodejs'
export const maxDuration = 300

type Params = { params: Promise<{ productId: string }> }

// 잡이 RUNNING으로 남아있다고 간주할 최대 시간 — 300초 함수가 죽어도 이보다는 짧게 판단.
const STALE_RUNNING_MS = 10 * 60 * 1000

export async function POST(req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true, name: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return errorResponse('잘못된 요청 형식입니다', 400)
  }

  const parsed = productExtractRequestSchema.safeParse(body)
  if (!parsed.success) {
    return errorResponse('invalid input', 400, { errors: parsed.error.flatten() })
  }
  const { url, urlText, pastedText, files, imageUrls } = parsed.data

  // 다른 Space가 남의 storagePath를 참조하지 못하게 막는 가드.
  for (const f of files) {
    if (!isOwnedSourcePath(f.storagePath, resolved.space.id, productId)) {
      return errorResponse('허용되지 않는 첨부 파일입니다', 400)
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.byteSize, 0)
  if (totalBytes > MAX_JOB_INLINE_BYTES) {
    return errorResponse('첨부 파일 합계 용량이 제한(12MB)을 초과했습니다', 413)
  }

  let reservation
  try {
    reservation = await reserveTextCredit({
      spaceId: resolved.space.id,
      userId: resolved.user.id,
      provider: 'gemini',
      model: EXTRACT_MODEL,
      responseFormat: 'json',
    })
  } catch (err) {
    if (err instanceof TextCreditExceededError) {
      return errorResponse('이번 달 AI 추출 한도를 모두 사용했습니다', 429, {
        code: 'TEXT_CREDIT_EXCEEDED',
      })
    }
    throw err
  }

  // 잡 + 소재를 PENDING으로 생성한 뒤 RUNNING으로 전환 — 여기까지는 트랜잭션.
  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.productExtractionJob.create({
      data: {
        spaceId: resolved.space.id,
        productId,
        status: 'PENDING',
        model: EXTRACT_MODEL,
        creditMonth: reservation.yearMonth,
        textLogId: reservation.reservationId,
        createdByUserId: resolved.user.id,
      },
    })

    const sourceData: Prisma.ProductExtractionSourceCreateManyInput[] = []
    if (url && urlText?.trim()) {
      sourceData.push({
        jobId: created.id,
        spaceId: resolved.space.id,
        kind: 'URL',
        url,
        textContent: urlText,
      })
    }
    if (pastedText?.trim()) {
      sourceData.push({
        jobId: created.id,
        spaceId: resolved.space.id,
        kind: 'TEXT',
        textContent: pastedText,
      })
    }
    for (const f of files) {
      sourceData.push({
        jobId: created.id,
        spaceId: resolved.space.id,
        kind: f.mimeType === 'application/pdf' ? 'PDF' : 'IMAGE',
        storagePath: f.storagePath,
        fileName: f.fileName,
        mimeType: f.mimeType,
        byteSize: f.byteSize,
      })
    }
    if (sourceData.length > 0) {
      await tx.productExtractionSource.createMany({ data: sourceData })
    }

    return tx.productExtractionJob.update({
      where: { id: created.id },
      data: { status: 'RUNNING' },
      include: { sources: true },
    })
  })

  // 이 지점부터는 잡 row 가 RUNNING 이다. 아래 모든 종료 경로(성공/실패/예외)에서
  // 반드시 잡 상태를 SUCCEEDED 또는 FAILED 로 갱신한다 — RUNNING 방치 금지.
  try {
    const textParts: ExtractSourcePart[] = job.sources
      .filter((s) => s.kind === 'URL' || s.kind === 'TEXT')
      .map((s) => ({
        kind: 'text' as const,
        label: s.kind === 'URL' ? `URL 소재 (${s.url ?? ''})` : '직접 입력 텍스트',
        text: s.textContent ?? '',
      }))

    const fileSources = job.sources.filter((s) => s.kind === 'IMAGE' || s.kind === 'PDF')
    const inlineParts: ExtractSourcePart[] = []
    // 업로드 파일 + URL 상세이미지가 같은 12MB 예산(MAX_JOB_INLINE_BYTES)을 공유한다.
    // files는 위에서 이미 413으로 사전 검증했으므로 여기서는 실 다운로드 바이트로 누적한다.
    let inlineBudgetBytes = 0
    for (const s of fileSources) {
      if (!s.storagePath || !s.mimeType) continue
      const bytes = await downloadProductSourceFile(s.storagePath)
      inlineBudgetBytes += bytes.byteLength
      inlineParts.push({
        kind: 'inline',
        mimeType: s.mimeType,
        data: bytes,
        fileName: s.fileName ?? 'file',
      })
    }

    // URL 소재 HTML에서 뽑아낸 상세 이미지를 내려받아 멀티모달 입력에 추가한다.
    // 한국 쇼핑몰 상세페이지는 소재·인증 정보가 HTML 텍스트가 아니라 이미지 안에 박혀 있는
    // 경우가 많아, 이미지 없이는 URL 소재가 사실상 무용지물이다.
    // - 개별 이미지 실패(404/타임아웃/MIME 불일치/SSRF 차단 등)는 전체를 죽이지 않고 건너뛴다.
    // - 12MB 예산을 넘기면 더 받지 않되, 몇 장을 못 넣었는지 imageFetchStats에 남긴다(무음 절단 금지).
    const imageParts: ExtractSourcePart[] = []
    let imgSucceeded = 0
    let imgFailed = 0
    let imgSkippedByteLimit = 0
    for (let i = 0; i < imageUrls.length; i++) {
      if (inlineBudgetBytes >= MAX_JOB_INLINE_BYTES) {
        imgSkippedByteLimit += imageUrls.length - i
        break
      }
      const imgUrl = imageUrls[i]
      try {
        const fetched = await safeFetchBinary(imgUrl)
        if (inlineBudgetBytes + fetched.bytes.byteLength > MAX_JOB_INLINE_BYTES) {
          imgSkippedByteLimit += imageUrls.length - i
          break
        }
        inlineBudgetBytes += fetched.bytes.byteLength
        imageParts.push({
          kind: 'inline',
          mimeType: fetched.mimeType,
          data: fetched.bytes,
          fileName: `상세이미지-${i + 1}`,
        })
        imgSucceeded += 1
      } catch (err) {
        imgFailed += 1
        const detail = err instanceof SafeFetchError ? `${err.code}: ${err.message}` : String(err)
        console.warn('[sh/products/extract] 상세 이미지 다운로드 실패 — 건너뛰고 계속 진행', {
          productId,
          jobId: job.id,
          imgUrl,
          detail,
        })
      }
    }
    const imageFetchStats: ImageFetchStats = {
      requested: imageUrls.length,
      succeeded: imgSucceeded,
      failed: imgFailed,
      skippedByteLimit: imgSkippedByteLimit,
    }

    const extracted = await extractProductInfo({
      productName: product.name,
      parts: [...textParts, ...inlineParts, ...imageParts],
    })

    // URL 소재 row(kind=URL)의 기존 byteSize 필드에 "실제로 모델에 넣은 이미지 총 바이트"를
    // 남긴다 — 이미지별 ProductExtractionSource row는 만들지 않는다(그 storagePath는 우리
    // 버킷 객체 대조용이라 외부 URL을 섞으면 고아 파일 정리 cron의 대조가 오염된다).
    // 상세 성공/실패/한도초과 개수는 구조화된 필드가 없어 job.result에 imageFetchStats로 병기한다.
    const urlSource = job.sources.find((s) => s.kind === 'URL')
    const imageBytesUsed = imageParts.reduce(
      (sum, p) => sum + (p.kind === 'inline' ? p.data.byteLength : 0),
      0
    )
    if (urlSource && imageUrls.length > 0) {
      await prisma.productExtractionSource.update({
        where: { id: urlSource.id },
        data: { byteSize: imageBytesUsed },
      })
    }

    const resultWithImageStats: Prisma.InputJsonValue = {
      ...(extracted.result as unknown as Record<string, unknown>),
      imageFetchStats: imageFetchStats as unknown as Prisma.InputJsonValue,
    } as Prisma.InputJsonValue

    const succeeded = await prisma.productExtractionJob.update({
      where: { id: job.id },
      data: {
        status: 'SUCCEEDED',
        result: resultWithImageStats,
        rawResponse: extracted.raw.slice(0, 20000),
        inputTokens: extracted.usage.inputTokens,
        outputTokens: extracted.usage.outputTokens,
        latencyMs: extracted.latencyMs,
      },
      include: { sources: true },
    })

    await commitTextCredit(reservation.reservationId, {
      inputTokens: extracted.usage.inputTokens ?? undefined,
      outputTokens: extracted.usage.outputTokens ?? undefined,
      latencyMs: extracted.latencyMs,
      contentPreview: extracted.result.description ?? undefined,
    })

    return NextResponse.json({ job: succeeded })
  } catch (err) {
    let errorCode: string
    let userMessage: string
    let rawText: string | undefined

    if (err instanceof ProductExtractError) {
      errorCode = err.code
      userMessage = err.message // 이미 한국어 메시지
      rawText = err.rawText
    } else if (err instanceof ProductSourceUploadError) {
      errorCode = err.code
      userMessage = err.message // 이미 한국어 메시지
    } else {
      errorCode = 'UNKNOWN'
      userMessage = '상품 정보 추출 중 오류가 발생했습니다'
    }
    const errorDetail = err instanceof Error ? err.message : String(err)

    await prisma.productExtractionJob
      .update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorCode,
          errorMessage: errorDetail,
          ...(rawText !== undefined && { rawResponse: rawText.slice(0, 20000) }),
        },
      })
      .catch((updateErr) => {
        // 잡 상태 갱신 자체가 실패하면 RUNNING 으로 남는다 — 최소한 로그로 남겨
        // GET 의 stale-RUNNING 가드가 뒤늦게라도 정리하게 한다.
        console.error('[sh/products/extract] 잡 FAILED 갱신 실패 — RUNNING 방치 위험', {
          jobId: job.id,
          updateErr,
        })
      })

    await refundTextCredit(reservation.reservationId, errorCode, errorDetail)

    console.error('[sh/products/extract] 추출 실패', {
      productId,
      jobId: job.id,
      errorCode,
      errorDetail,
    })
    return errorResponse(userMessage, 500, { code: errorCode })
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  const resolved = await resolveDeckContext('seller-hub')
  if ('error' in resolved) return resolved.error

  const { productId } = await params
  const product = await prisma.invProduct.findFirst({
    where: { id: productId, spaceId: resolved.space.id },
    select: { id: true },
  })
  if (!product) return errorResponse('상품을 찾을 수 없습니다', 404)

  // 300초 함수가 응답을 남기지 못하고 죽으면 잡이 RUNNING 에 영영 머문다.
  // 조회 직전 오래된(10분+) RUNNING 잡을 FAILED(TIMEOUT)로 실제 전환해 화면에 반영한다.
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS)
  await prisma.productExtractionJob.updateMany({
    where: {
      productId,
      spaceId: resolved.space.id,
      status: 'RUNNING',
      createdAt: { lt: staleBefore },
    },
    data: {
      status: 'FAILED',
      errorCode: 'TIMEOUT',
      errorMessage: '작업이 시간 내에 끝나지 않았습니다',
    },
  })

  const jobs = await prisma.productExtractionJob.findMany({
    where: { productId, spaceId: resolved.space.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      spaceId: true,
      productId: true,
      status: true,
      provider: true,
      model: true,
      promptVersion: true,
      result: true,
      inputTokens: true,
      outputTokens: true,
      latencyMs: true,
      errorCode: true,
      errorMessage: true,
      textLogId: true,
      creditMonth: true,
      appliedAt: true,
      appliedFields: true,
      rolledBackAt: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,
      sources: { orderBy: { createdAt: 'asc' } },
    },
  })

  return NextResponse.json({ jobs })
}
